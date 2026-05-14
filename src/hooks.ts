import { promises as fs, rmSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Hooks } from "@opencode-ai/plugin"
import { DEFAULT_PREFIX, type HashlineRuntimeConfig, HashlineAnnotationCache, shouldExclude } from "./shared.js"
import { computeFileRev, getAdaptiveHashLength } from "./hash.js"
import { formatAnnotatedLine } from "./ref.js"
import { canonicalizeFileText, restoreFileText } from "./file-text.js"
import { applyHashlineEdits } from "./edit-ops.js"

const HASHLINE_SYSTEM_INSTRUCTION_MARKER_RE = /<!--[\s]*hashline-instruction-v\d+[\s]*-->/i
const HASHLINE_SYSTEM_INSTRUCTION_BLOCK_RE = /<!--[\s]*hashline-instruction-v\d+[\s]*-->[\s\S]*?(?:<!--[\s]*\/hashline-instruction-v\d+[\s]*-->|$)/gi

const CONTENT_FIELD_KEYS = new Set([
  "content", "new_content", "old_content", "old_string", "new_string",
  "replacement", "text", "diff", "patch", "patch_text", "patchText", "body",
])

function stripNestedHashes(value: unknown, prefix: string | false): unknown {
  if (typeof value === "string") return stripHashlinePrefixes(value, prefix)
  if (Array.isArray(value)) return value.map((e) => stripNestedHashes(e, prefix))
  if (!value || typeof value !== "object") return value
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

function stripHashlinePrefixes(content: string, prefix: string | false): string {
  const effectivePrefix = prefix === false ? "" : prefix || DEFAULT_PREFIX
  const escapedPrefix = effectivePrefix ? effectivePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : ""
  const prefixPattern = escapedPrefix ? `${escapedPrefix}\\s*` : ""
  const refPattern = new RegExp(
    `^([+\\- ])?${prefixPattern}\\d+\\s*[#: ]\\s*[A-Za-z0-9]+(?:\\s*[#: ]\\s*[A-Za-z0-9]+)?\\|`, "i",
  )
  const revPattern = new RegExp(`^${prefixPattern}REV:[A-Za-z0-9]{8}$`, "i")
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n"
  const normalized = content.replace(/\r\n/g, "\n")
  return normalized
    .split("\n")
    .filter((line) => !revPattern.test(line))
    .map((line) => {
      const match = line.match(refPattern)
      return match ? (match[1] ?? "") + line.slice(match[0].length) : line
    })
    .join(lineEnding === "\r\n" ? "\r\n" : "\n")
}

function getByteLength(content: string): number {
  return new TextEncoder().encode(content).length
}

function extractPathFromToolArgs(args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined
  const c = args.path ?? args.filePath ?? args.file_path ?? args.file
  return typeof c === "string" && c.length > 0 ? (c as string) : undefined
}

function resolveFilePath(filePath: string, directory?: string): string {
  const base = typeof directory === "string" && directory.length > 0 ? directory : process.cwd()
  return path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(base, filePath)
}

function formatWithRuntimeConfig(content: string, config: HashlineRuntimeConfig): string {
  const effectivePrefix = config.prefix === false ? "" : config.prefix || DEFAULT_PREFIX
  const prefixPart = effectivePrefix ? `${effectivePrefix} ` : ""
  const normalized = content.includes("\r\n") ? content.replace(/\r\n/g, "\n") : content
  const lines = normalized.split("\n")
  const out: string[] = []
  const hashLen = getAdaptiveHashLength(lines.length)
  if (config.fileRev !== false) {
    out.push(`${prefixPart}REV:${computeFileRev(normalized)}`)
  }
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    const displayLine = line.length > 2000 ? `${line.slice(0, 2000)}…` : line
    const annotated = formatAnnotatedLine(line, idx, lines, effectivePrefix, hashLen)
    const sepIdx = annotated.indexOf("|")
    out.push(`${annotated.slice(0, sepIdx + 1)}${displayLine}`)
  }
  if (lines.length === 0) out.push("# file is empty")
  return out.join("\n")
}

function buildHashlineSystemInstruction(config: HashlineRuntimeConfig): string {
  const prefixLabel = config.prefix === false ? "none" : `"${config.prefix || DEFAULT_PREFIX}"`
  return [
    "<!-- hashline-instruction-v1 -->",
    "Hashline workflow:",
    `- Read returns canonical refs like \`${DEFAULT_PREFIX} 12#A3F#9BC\` and \`${DEFAULT_PREFIX} REV:72C4946C\`. Copy refs exactly as shown.`,
    `- Active prefix: ${prefixLabel}. Read output stays canonical \`${DEFAULT_PREFIX}\`.`,
    "- After one read, batch same-file changes into one edit call with operations[] instead of many single edits.",
    "- Send fileRev when the read output includes a REV line.",
    "- Reread only when you need more context or an edit fails because refs are stale.",
    "- Prefer edit for targeted changes; use write only for new files or full rewrites.",
    "<!-- /hashline-instruction-v1 -->",
  ].join("\n")
}

function updateSystemInstructions(system: string[], instruction: string): string[] {
  const next: string[] = []
  let inserted = false
  for (const entry of system) {
    if (!HASHLINE_SYSTEM_INSTRUCTION_MARKER_RE.test(entry)) {
      next.push(entry)
      continue
    }
    if (!inserted) {
      next.push(entry.replace(HASHLINE_SYSTEM_INSTRUCTION_BLOCK_RE, () => instruction))
      inserted = true
    } else {
      const cleaned = entry.replace(HASHLINE_SYSTEM_INSTRUCTION_BLOCK_RE, () => "")
      if (cleaned.trim().length > 0) next.push(cleaned)
    }
  }
  if (!inserted) next.push(instruction)
  return next
}

async function readAndAnnotate(
  absolutePath: string,
  config: HashlineRuntimeConfig,
  cache: HashlineAnnotationCache,
  directory?: string,
): Promise<string | null> {
  let source: string
  try {
    source = await fs.readFile(absolutePath, "utf8")
  } catch { return null }
  if (config.maxFileSize > 0 && getByteLength(source) > config.maxFileSize) return null
  const cacheKey = path.isAbsolute(absolutePath) ? absolutePath : path.resolve(directory ?? process.cwd(), absolutePath)
  const cached = cache.get(cacheKey, source)
  if (cached) return cached
  const annotated = formatWithRuntimeConfig(source, config)
  cache.set(cacheKey, source, annotated)
  return annotated
}

let tempDirPath: string | null = null
let tempCleanupRegistered = false

async function getTempDir(): Promise<string> {
  if (!tempDirPath) {
    tempDirPath = await fs.mkdtemp(path.join(tmpdir(), "hashline-chat-"))
    if (!tempCleanupRegistered) {
      tempCleanupRegistered = true
      process.on("exit", () => {
        if (tempDirPath) try { rmSync(tempDirPath, { recursive: true, force: true }) } catch { }
      })
    }
  }
  return tempDirPath
}

export function createHashlineHooks(
  config: HashlineRuntimeConfig,
  cache?: HashlineAnnotationCache,
): Pick<Hooks, "tool.definition" | "tool.execute.after" | "experimental.chat.system.transform" | "chat.message"> {
  const effectiveCache = cache ?? new HashlineAnnotationCache(config.cacheSize ?? 128)

  return {
    "tool.definition": async (_input, output) => {
      if (_input.toolID === "read" || _input.toolID === "view") {
        output.description = `${output.description}\n\nHashline: Returns canonical ${DEFAULT_PREFIX} refs plus a REV token. Copy refs exactly from the output, then plan all same-file changes before calling edit.`
      }
      if (_input.toolID === "write") {
        output.description = `${output.description}\n\nHashline: Use write for new files or full rewrites. Prefer edit for targeted existing-file changes; hashline prefixes inside content are stripped automatically.`
      }
      if (_input.toolID === "patch") {
        output.description = `${output.description}\n\nHashline: Compatibility path only. Prefer read -> one batched edit per file for a faster, lower-read workflow.`
      }
    },

    "tool.execute.after": async (_input, output) => {
      const args = (_input.args ?? {}) as Record<string, unknown>
      const isEditLike = ["edit", "write", "patch", "hashline_edit"].some(
        (t) => _input.tool === t || _input.tool.toLowerCase().endsWith(`.${t}`),
      )
      if (isEditLike) {
        const fp = extractPathFromToolArgs(args)
        if (fp) {
          const dir = typeof (_input as any).directory === "string" ? (_input as any).directory : undefined
          const absPath = resolveFilePath(fp, dir)
          effectiveCache.invalidateVariants(absPath)
        }
      }
      const isReadLike = _input.tool === "read" || _input.tool === "view" ||
        _input.tool.toLowerCase().endsWith(".read") || _input.tool.toLowerCase().endsWith(".view")
      if (!isReadLike) return
      if (typeof output.output !== "string") return
      if (output.output.includes("<type>directory</type>")) return
      const filePathFromArgs = extractPathFromToolArgs(args)
      if (typeof filePathFromArgs !== "string") return
      const dir = typeof (_input as any).directory === "string" ? (_input as any).directory : undefined
      const canonicalPath = resolveFilePath(filePathFromArgs, dir)
      if (shouldExclude(canonicalPath, config.exclude)) return
      const offset = typeof args.offset === "number" ? args.offset : undefined
      const limit = typeof args.limit === "number" ? args.limit : undefined
      const cacheKey = `${canonicalPath}\u0000${offset ?? ""}\u0000${limit ?? ""}`
      const cached = effectiveCache.get(cacheKey, output.output)
      if (cached) { output.output = cached; return }
      const absolutePath = resolveFilePath(filePathFromArgs, dir)
      const annotated = await readAndAnnotate(absolutePath, config, effectiveCache, dir)
      if (annotated) output.output = annotated
    },

    "experimental.chat.system.transform": async (_input, output) => {
      const target = output as { system?: string[] }
      if (!Array.isArray(target.system)) target.system = []
      target.system = updateSystemInstructions(target.system, buildHashlineSystemInstruction(config))
    },

    "chat.message": async (_input, output) => {
      const parts = (output as any).parts as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(parts) || parts.length === 0) return
      for (const part of parts) {
        if (!part || part.type !== "file") continue
        const url = typeof part.url === "string" ? part.url : undefined
        if (!url || !url.startsWith("file://")) continue
        let absolutePath: string
        try { absolutePath = path.normalize(fileURLToPath(url)) } catch { continue }
        if (shouldExclude(absolutePath, config.exclude)) continue
        const annotated = await readAndAnnotate(absolutePath, config, effectiveCache)
        if (!annotated) continue
        const tempPath = path.join(await getTempDir(), `hl-${Date.now()}-${randomBytes(6).toString("hex")}.txt`)
        await fs.writeFile(tempPath, annotated, "utf8")
        part.url = pathToFileURL(tempPath).href
        part.content = annotated
      }
    },
  }
}
