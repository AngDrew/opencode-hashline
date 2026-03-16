import path from "node:path"
import { promises as fs, rmSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Hooks } from "@opencode-ai/plugin"
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

const FILE_READ_TOOLS = ["hash-read"]
const FILE_EDIT_TOOLS = ["hash-edit", "hash-write", "hash-patch", "hash-check"]

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

export function createHashlineHooks(config: HashlineRuntimeConfig, cache: HashlineAnnotationCache): HashlinePluginHooks {
  return {
    "tool.execute.before": async (input, output) => {
      const name = input.tool

      if (!isFileEditTool(name)) {
        return
      }

      const args = (output.args ?? {}) as Record<string, unknown>
      const stripped = stripNestedHashes(args, config.prefix)
      if (!stripped || typeof stripped !== "object" || Array.isArray(stripped)) {
        return
      }

      const strippedArgs = stripped as Record<string, unknown>
      for (const key of Object.keys(args)) {
        delete args[key]
      }

      for (const [key, value] of Object.entries(strippedArgs)) {
        args[key] = value
      }
    },

    "tool.execute.after": async (input, output) => {
      const args = (input.args ?? {}) as Record<string, unknown>
      if (!isFileReadTool(input.tool, args)) {
        return
      }

      if (typeof output.output !== "string") {
        return
      }

      const source = output.output
      const alreadyAnnotated = stripHashlinePrefixes(source, config.prefix) !== source
      if (
        source.includes("<hashline-file ") ||
        alreadyAnnotated ||
        source.includes("# format: <line>#<hash>#<anchor>|<content>") ||
        source.includes("# format: <line>#<hash>|<content>")
      ) {
        return
      }

      if (config.maxFileSize > 0 && getByteLength(source) > config.maxFileSize) {
        return
      }

      const filePathFromArgs = extractPathFromToolArgs(args)
      if (typeof filePathFromArgs === "string" && shouldExclude(filePathFromArgs, config.exclude)) {
        return
      }

      const cacheKey = filePathFromArgs ?? `${input.tool}:${source.length}`
      const cached = cache.get(cacheKey, source)
      if (cached) {
        output.output = cached
        return
      }

      const annotated = formatWithRuntimeConfig(source, config)

      cache.set(cacheKey, source, annotated)
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
        cache,
      )
    },
  }
}
