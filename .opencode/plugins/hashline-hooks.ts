import path from "node:path"
import { promises as fs, rmSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Hooks } from "@opencode-ai/plugin"
import {
  resolveFilePath,
  runHashlineRead,
} from "../lib/hashline-core.js"
import {
  buildCacheEntryKey,
  buildHashlineSystemInstruction,
  DEFAULT_PREFIX,
  extractPathFromToolArgs,
  formatWithRuntimeConfig,
  getByteLength,
  HashlineAnnotationCache,
  shouldExclude,
  stripHashlinePrefixes,
  type HashlineRuntimeConfig,
} from "./hashline-shared.js"

const FILE_EDIT_TOOLS = ["hashline_edit", "hashline_write", "hashline_patch", "edit", "write", "patch", "apply_patch", "file_edit", "file_write", "edit_file", "multiedit", "batch"]

function toolEndsWith(tool: string, known: string[]): boolean {
  const lower = tool.toLowerCase()
  return known.some((item) => lower === item || lower.endsWith(`.${item}`))
}

function isFileReadTool(tool: string, _args?: Record<string, unknown>): boolean {
  const lower = tool.toLowerCase()
  return lower === "read" || lower === "view" || lower.endsWith(".read") || lower.endsWith(".view")
}

function isFileEditTool(tool: string): boolean {
  return toolEndsWith(tool, FILE_EDIT_TOOLS)
}

const HASHLINE_SYSTEM_INSTRUCTION_MARKER_RE = /<!--[\s]*hashline-instruction-v\d+[\s]*-->/i
const HASHLINE_SYSTEM_INSTRUCTION_BLOCK_RE = /<!--[\s]*hashline-instruction-v\d+[\s]*-->[\s\S]*?(?:<!--[\s]*\/hashline-instruction-v\d+[\s]*-->|$)/gi
const MAX_SYSTEM_ENTRIES = 128

function normalizeHashlineInstructionEntry(entry: string, instruction: string, keepInstruction: boolean): string {
  let insertedInstruction = false

  return entry.replace(HASHLINE_SYSTEM_INSTRUCTION_BLOCK_RE, () => {
    if (!keepInstruction) {
      return ""
    }

    if (insertedInstruction) {
      return ""
    }

    insertedInstruction = true
    return instruction
  })
}

function updateSystemInstructions(system: string[], instruction: string): string[] {
  const nextSystem: string[] = []
  let insertedInstruction = false

  for (const entry of system) {
    if (!HASHLINE_SYSTEM_INSTRUCTION_MARKER_RE.test(entry)) {
      nextSystem.push(entry)
      continue
    }

    if (!insertedInstruction) {
      nextSystem.push(normalizeHashlineInstructionEntry(entry, instruction, true))
      insertedInstruction = true
      continue
    }

    const cleaned = normalizeHashlineInstructionEntry(entry, instruction, false)
    if (cleaned.trim().length > 0) {
      nextSystem.push(cleaned)
    }
  }

  if (!insertedInstruction) {
    nextSystem.push(instruction)
  }

  return nextSystem
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
  cache.invalidateVariants(filePath)
  cache.invalidateVariants(canonicalPath)
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
  | "tool.definition"
  | "tool.execute.before"
  | "tool.execute.after"
  | "experimental.chat.system.transform"
  | "chat.message"
>

export function createHashlineHooks(config: HashlineRuntimeConfig, cache?: HashlineAnnotationCache): HashlinePluginHooks {
  const effectiveCache = cache ?? new HashlineAnnotationCache(config.cacheSize ?? 128)

  return {
    "tool.definition": async (input, output) => {
      if (input.toolID === "read" || input.toolID === "view") {
        output.description = `${output.description}\n\nHashline: Returns canonical ${DEFAULT_PREFIX} refs plus a REV token. Copy refs exactly from the output, then plan all same-file changes before calling edit.`
      }

      if (input.toolID === "write") {
        output.description = `${output.description}\n\nHashline: Use write for new files or full rewrites. Prefer edit for targeted existing-file changes; hashline prefixes inside content are stripped automatically.`
      }

      if (input.toolID === "patch") {
        output.description = `${output.description}\n\nHashline: Compatibility path only. Prefer read -> one batched edit per file for a faster, lower-read workflow.`
      }
    },

    "tool.execute.before": async (input, output) => {
      const name = input.tool

      if (!isFileEditTool(name)) {
        return
      }

      const args = (output.args ?? {}) as Record<string, unknown>
      output.args = stripNestedHashes(args, config.prefix) as Record<string, unknown>
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

      const source = output.output
      if (source.includes("<type>directory</type>")) {
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
      const cacheKey = buildCacheEntryKey(canonicalPath, offset, limit)
      const cached = effectiveCache.get(cacheKey, source)
      if (cached) {
        output.output = cached
        return
      }

      try {
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

        if (typeof annotated !== "string") {
          return
        }

        if (config.maxFileSize > 0 && getByteLength(annotated) > config.maxFileSize) {
          return
        }

        effectiveCache.set(cacheKey, source, annotated)
        output.output = annotated
      } catch {
        return
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      const target = output as { system?: string[] }
      if (!Array.isArray(target.system)) {
        target.system = []
      }

      if (target.system.length > MAX_SYSTEM_ENTRIES) {
        console.warn(
          `hashline: experimental.chat.system.transform received ${target.system.length} system entries; deduplicating the hashline instruction block to avoid prompt bloat.`,
        )
      }

      target.system = updateSystemInstructions(target.system, buildHashlineSystemInstruction(config))
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
