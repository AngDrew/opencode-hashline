import path from "node:path"
import { promises as fs, rmSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Hooks } from "@opencode-ai/plugin"
import {
  mapOperationInput,
  resolveFilePath,
  runHashlineRead,
  runHashlineOperationsDetailed,
  type HashlineOperationInput,
} from "../lib/hashline-core.js"
import {
  buildHashlineSystemInstruction,
  extractPathFromToolArgs,
  formatWithRuntimeConfig,
  getByteLength,
  HashlineAnnotationCache,
  shouldExclude,
  stripHashlinePrefixes,
  type HashlineRuntimeConfig,
} from "./hashline-shared"

const FILE_READ_TOOLS = ["hashline_read", "read", "file_read", "read_file", "cat", "view"]
const FILE_EDIT_TOOLS = ["hashline_edit", "hashline_write", "hashline_patch", "edit", "write", "patch", "apply_patch", "file_edit", "file_write", "edit_file", "multiedit", "batch"]

function toolEndsWith(tool: string, known: string[]): boolean {
  const lower = tool.toLowerCase()
  return known.some((item) => lower === item || lower.endsWith(`.${item}`))
}

function isFileReadTool(tool: string, args?: Record<string, unknown>): boolean {
  if (toolEndsWith(tool, FILE_READ_TOOLS)) {
    return true
  }

  const candidate = extractPathFromToolArgs(args)
  if (!candidate) {
    return false
  }

  const lower = tool.toLowerCase()
  const writeHints = ["write", "edit", "patch", "execute", "run", "command", "shell", "bash"]
  return !writeHints.some((hint) => lower.includes(hint))
}

function isFileEditTool(tool: string): boolean {
  return toolEndsWith(tool, FILE_EDIT_TOOLS)
}

function isNativeEditTool(tool: string): boolean {
  return toolEndsWith(tool, ["edit"])
}

function getCanonicalPath(filePath: string, input?: Record<string, unknown>): string {
  try {
    return resolveFilePath(filePath, {
      directory: typeof input?.directory === "string" ? input.directory : undefined,
    })
  } catch {
    return filePath
  }
}

function invalidateFileCache(
  cache: HashlineAnnotationCache,
  args: Record<string, unknown>,
  input?: Record<string, unknown>,
): void {
  const filePath = extractPathFromToolArgs(args)
  if (!filePath) {
    return
  }

  const canonicalPath = getCanonicalPath(filePath, input)
  cache.invalidate(filePath)
  cache.invalidate(canonicalPath)
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  }

  return undefined
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value
    }
  }

  return undefined
}

function hasHashlineEditShape(args: Record<string, unknown>): boolean {
  return (
    Array.isArray(args.operations) ||
    typeof args.operation === "string" ||
    typeof args.ref === "string" ||
    typeof args.startRef === "string" ||
    typeof args.start_ref === "string"
  )
}

function toHashlineOperations(args: Record<string, unknown>): HashlineOperationInput[] | null {
  if (Array.isArray(args.operations) && args.operations.length > 0) {
    return args.operations.map((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>
      return {
        op: String(item.op ?? "") as HashlineOperationInput["op"],
        ref: firstString(item.ref),
        startRef: firstString(item.startRef, item.start_ref),
        endRef: firstString(item.endRef, item.end_ref),
        content: firstString(item.content, item.replacement),
      }
    })
  }

  const operation = firstString(args.operation)
  if (!operation) {
    return null
  }

  const ref = firstString(args.ref)
  const startRef = firstString(args.startRef, args.start_ref, ref)
  const endRef = firstString(args.endRef, args.end_ref)
  const content = firstString(args.replacement, args.content)

  if (!startRef && !ref) {
    return null
  }

  return [
    {
      op: operation === "replace" && endRef ? "replace_range" : (operation as HashlineOperationInput["op"]),
      ref,
      startRef,
      endRef,
      content,
    },
  ]
}

async function translateHashlineEditArgs(
  args: Record<string, unknown>,
  input: Record<string, unknown>,
  config: HashlineRuntimeConfig,
): Promise<Record<string, unknown> | null> {
  if (!hasHashlineEditShape(args)) {
    return null
  }

  const filePath = firstString(args.filePath, args.file_path, args.path, args.file)
  if (!filePath) {
    return null
  }

  const operations = toHashlineOperations(args)
  if (!operations || operations.length === 0) {
    return null
  }

  const result = await runHashlineOperationsDetailed({
    filePath,
    operations: operations.map(mapOperationInput),
    expectedFileHash: firstString(args.expectedFileHash, args.expected_file_hash),
    fileRev: firstString(args.fileRev, args.file_rev),
    safeReapply: firstBoolean(args.safeReapply, args.safe_reapply) ?? config.safeReapply,
    dryRun: true,
    context: {
      directory: typeof input.directory === "string" ? input.directory : undefined,
    },
  })

  return {
    filePath,
    oldString: result.metadata.filediff.before,
    newString: result.metadata.filediff.after,
  }
}

const CONTENT_FIELD_KEYS = new Set([
  "content",
  "new_content",
  "old_content",
  "old_string",
  "new_string",
  "replacement",
  "text",
  "diff",
  "patch",
  "patch_text",
  "patchText",
  "body",
])

function stripNestedHashes(value: unknown, prefix: string | false): unknown {
  if (typeof value === "string") {
    return stripHashlinePrefixes(value, prefix)
  }

  if (Array.isArray(value)) {
    return value.map((entry) => stripNestedHashes(entry, prefix))
  }

  if (!value || typeof value !== "object") {
    return value
  }

  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  for (const key of Object.keys(out)) {
    if (CONTENT_FIELD_KEYS.has(key)) {
      out[key] = stripNestedHashes(out[key], prefix)
      continue
    }

    const candidate = out[key]
    if (Array.isArray(candidate) || (candidate && typeof candidate === "object")) {
      out[key] = stripNestedHashes(candidate, prefix)
    }
  }

  return out
}

let tempDirPromise: Promise<string> | null = null
let tempDirPath: string | null = null
let tempCleanupRegistered = false

async function getTempDirectory(): Promise<string> {
  if (!tempDirPromise) {
    tempDirPromise = fs.mkdtemp(path.join(tmpdir(), "hashline-chat-")).then((dir) => {
      tempDirPath = dir

      if (!tempCleanupRegistered) {
        tempCleanupRegistered = true
        process.on("exit", () => {
          if (!tempDirPath) {
            return
          }

          try {
            rmSync(tempDirPath, { recursive: true, force: true })
          } catch {
            // ignore cleanup errors on exit
          }
        })
      }

      return dir
    })
  }

  return tempDirPromise
}

async function writeAnnotatedTempFile(content: string): Promise<string> {
  const tempDir = await getTempDirectory()
  const fileName = `hl-${Date.now()}-${randomBytes(6).toString("hex")}.txt`
  const tempPath = path.join(tempDir, fileName)
  await fs.writeFile(tempPath, content, "utf8")
  return tempPath
}

async function annotateChatMessageParts(
  output: { parts?: Array<Record<string, unknown>> },
  input: Record<string, unknown>,
  config: HashlineRuntimeConfig,
  cache: HashlineAnnotationCache,
): Promise<void> {
  if (!Array.isArray(output.parts) || output.parts.length === 0) {
    return
  }

  const contextDirectory = typeof input.directory === "string" ? input.directory : process.cwd()

  for (const part of output.parts) {
    if (!part || part.type !== "file") {
      continue
    }

    const url = typeof part.url === "string" ? part.url : undefined
    if (!url || !url.startsWith("file://")) {
      continue
    }

    let absolutePath: string
    try {
      absolutePath = path.normalize(fileURLToPath(url))
    } catch {
      continue
    }

    if (shouldExclude(absolutePath, config.exclude)) {
      continue
    }

    let source: string
    try {
      source = await fs.readFile(absolutePath, "utf8")
    } catch {
      continue
    }

    if (config.maxFileSize > 0 && getByteLength(source) > config.maxFileSize) {
      continue
    }

    const cacheKey = path.isAbsolute(absolutePath)
      ? absolutePath
      : path.resolve(contextDirectory, absolutePath)

    const cached = cache.get(cacheKey, source)
    const annotated = cached ?? formatWithRuntimeConfig(source, config)

    if (!cached) {
      cache.set(cacheKey, source, annotated)
    }

    const tempPath = await writeAnnotatedTempFile(annotated)
    part.url = pathToFileURL(tempPath).href
    part.content = annotated
  }
}

type HashlinePluginHooks = Pick<
  Hooks,
  "tool.execute.before" | "tool.execute.after" | "experimental.chat.system.transform" | "chat.message"
>

export function createHashlineHooks(config: HashlineRuntimeConfig, cache?: HashlineAnnotationCache): HashlinePluginHooks {
  const effectiveCache = cache ?? new HashlineAnnotationCache(config.cacheSize ?? 128)

  return {
    "tool.execute.before": async (input, output) => {
      const name = input.tool

      if (!isFileEditTool(name)) {
        return
      }

      const args = (output.args ?? {}) as Record<string, unknown>
      const sanitizedArgs = stripNestedHashes(args, config.prefix) as Record<string, unknown>

      if (isNativeEditTool(name)) {
        const translatedArgs = await translateHashlineEditArgs(
          sanitizedArgs,
          input as Record<string, unknown>,
          config,
        )
        if (translatedArgs) {
          output.args = translatedArgs
          return
        }
      }

      output.args = sanitizedArgs
    },

    "tool.execute.after": async (input, output) => {
      const args = (input.args ?? {}) as Record<string, unknown>

      if (isFileEditTool(input.tool)) {
        invalidateFileCache(effectiveCache, args, input as Record<string, unknown>)
      }

      if (!isFileReadTool(input.tool, args)) {
        return
      }

      if (typeof output.output !== "string") {
        return
      }

      const filePathFromArgs = extractPathFromToolArgs(args)
      if (typeof filePathFromArgs !== "string") {
        return
      }

      const canonicalPath = getCanonicalPath(filePathFromArgs, input as Record<string, unknown>)

      if (shouldExclude(filePathFromArgs, config.exclude)) {
        return
      }

      const offset = typeof args.offset === "number" ? args.offset : undefined
      const limit = typeof args.limit === "number" ? args.limit : undefined
      const sourceKey = JSON.stringify({ filePath: canonicalPath, offset, limit })
      const cacheKey = canonicalPath
      const cached = effectiveCache.get(cacheKey, sourceKey)
      if (cached) {
        output.output = cached
        return
      }

      const annotated = await runHashlineRead({
        filePath: filePathFromArgs,
        offset,
        limit,
        context: {
          directory: typeof (input as Record<string, unknown>).directory === "string"
            ? ((input as Record<string, unknown>).directory as string)
            : undefined,
        },
      })

      if (config.maxFileSize > 0 && getByteLength(annotated) > config.maxFileSize) {
        return
      }

      effectiveCache.set(cacheKey, sourceKey, annotated)
      output.output = annotated
    },

    "experimental.chat.system.transform": async (_input, output) => {
      const target = output as { system?: string[] }
      if (!Array.isArray(target.system)) {
        target.system = []
      }
      target.system.push(buildHashlineSystemInstruction(config))
    },

    "chat.message": async (input, output) => {
      await annotateChatMessageParts(
        output as { parts?: Array<Record<string, unknown>> },
        input as Record<string, unknown>,
        config,
        effectiveCache,
      )
    },
  }
}
