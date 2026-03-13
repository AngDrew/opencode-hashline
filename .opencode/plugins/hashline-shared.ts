import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { computeFileRev, getAdaptiveHashLength, hashlineAnchorHash, hashlineLineHash } from "../tools/hashline-core.js"
export { computeFileRev }

export interface HashlineRuntimeConfig {
  exclude: string[]
  maxFileSize: number
  cacheSize: number
  prefix: string | false
  fileRev: boolean
  safeReapply: boolean
}

const CONFIG_FILENAME = "opencode-hashline.json"

export const DEFAULT_PREFIX = ";;;"

export const DEFAULT_EXCLUDE_PATTERNS: string[] = [
  "**/node_modules/**",
  "**/*.lock",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.wasm",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.ico",
  "**/*.svg",
  "**/*.woff",
  "**/*.woff2",
  "**/*.ttf",
  "**/*.eot",
  "**/*.pdf",
  "**/*.zip",
  "**/*.tar",
  "**/*.gz",
  "**/*.exe",
  "**/*.dll",
  "**/*.so",
  "**/*.dylib",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/id_rsa",
  "**/id_rsa.pub",
  "**/id_ed25519",
  "**/id_ed25519.pub",
  "**/id_ecdsa",
  "**/id_ecdsa.pub",
]

export const DEFAULT_HASHLINE_RUNTIME_CONFIG: HashlineRuntimeConfig = {
  exclude: DEFAULT_EXCLUDE_PATTERNS,
  maxFileSize: 1_048_576,
  cacheSize: 100,
  prefix: DEFAULT_PREFIX,
  fileRev: true,
  safeReapply: false,
}

function hashText(text: string, length = 10): string {
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, length).toUpperCase()
}

function sanitizeConfig(input: unknown): Partial<HashlineRuntimeConfig> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {}
  }

  const source = input as Record<string, unknown>
  const out: Partial<HashlineRuntimeConfig> = {}

  if (Array.isArray(source.exclude)) {
    out.exclude = source.exclude.filter(
      (item): item is string => typeof item === "string" && item.length > 0 && item.length <= 512,
    )
  }

  if (typeof source.maxFileSize === "number" && Number.isFinite(source.maxFileSize) && source.maxFileSize >= 0) {
    out.maxFileSize = Math.floor(source.maxFileSize)
  }

  if (typeof source.cacheSize === "number" && Number.isFinite(source.cacheSize) && source.cacheSize > 0) {
    out.cacheSize = Math.floor(source.cacheSize)
  }

  if (source.prefix === false) {
    out.prefix = false
  } else if (typeof source.prefix === "string") {
    // Keep prefix simple and printable to avoid prompt/tool injection.
    if (/^[\x20-\x7E]{0,20}$/.test(source.prefix)) {
      out.prefix = source.prefix
    }
  }

  if (typeof source.fileRev === "boolean") {
    out.fileRev = source.fileRev
  }

  if (typeof source.safeReapply === "boolean") {
    out.safeReapply = source.safeReapply
  }

  return out
}

function readConfigFile(filePath: string): Partial<HashlineRuntimeConfig> | undefined {
  if (!existsSync(filePath)) {
    return undefined
  }

  try {
    const raw = readFileSync(filePath, "utf8")
    return sanitizeConfig(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export function resolveHashlineConfig(projectDir?: string): HashlineRuntimeConfig {
  const globalPath = path.join(homedir(), ".config", "opencode", CONFIG_FILENAME)
  const projectPath = projectDir ? path.join(projectDir, CONFIG_FILENAME) : undefined

  const globalConfig = readConfigFile(globalPath)
  const projectConfig = projectPath ? readConfigFile(projectPath) : undefined

  return {
    ...DEFAULT_HASHLINE_RUNTIME_CONFIG,
    ...globalConfig,
    ...projectConfig,
    exclude: (projectConfig?.exclude ?? globalConfig?.exclude ?? DEFAULT_EXCLUDE_PATTERNS).slice(),
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeGlobPath(value: string): string {
  return value.replace(/\\/g, "/")
}

export function shouldExclude(filePath: string, patterns: string[]): boolean {
  const normalizedPath = normalizeGlobPath(filePath)
  return patterns.some((pattern) => path.matchesGlob(normalizedPath, normalizeGlobPath(pattern)))
}

const textEncoder = new TextEncoder()

export function getByteLength(content: string): number {
  return textEncoder.encode(content).length
}

interface HashlineFormatOptions {
  prefix?: string | false
  includeFileRev?: boolean
}

export function formatWithHashline(content: string, options?: HashlineFormatOptions): string {
  const effectivePrefix = options?.prefix === undefined ? DEFAULT_PREFIX : options.prefix === false ? "" : options.prefix
  const normalized = content.includes("\r\n") ? content.replace(/\r\n/g, "\n") : content
  const lines = normalized.split("\n")
  const output: string[] = []

  if (options?.includeFileRev) {
    output.push(`${effectivePrefix}REV:${computeFileRev(normalized)}`)
  }

  const hashLength = getAdaptiveHashLength(lines.length)
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx]
    const lineHash = hashlineLineHash(line, hashLength)
    const anchorHash = hashlineAnchorHash(lines[idx - 1], line, lines[idx + 1], hashLength)
    output.push(`${effectivePrefix}${idx + 1}#${lineHash}#${anchorHash}|${line}`)
  }

  return output.join("\n")
}

export function formatWithRuntimeConfig(
  content: string,
  config: Pick<HashlineRuntimeConfig, "prefix" | "fileRev">,
): string {
  return formatWithHashline(content, {
    prefix: config.prefix,
    includeFileRev: config.fileRev,
  })
}

export function stripHashlinePrefixes(content: string, prefix?: string | false): string {
  const effectivePrefix = prefix === undefined ? DEFAULT_PREFIX : prefix === false ? "" : prefix
  const escapedPrefix = escapeRegex(effectivePrefix)
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n"
  const normalized = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content

  const refPattern = new RegExp(`^([+\\- ])?${escapedPrefix}\\d+\\s*[#: ]\\s*[A-Za-z0-9]+(?:\\s*[#: ]\\s*[A-Za-z0-9]+)?\\|`)
  const revPattern = new RegExp(`^${escapedPrefix}REV:[A-Za-z0-9]{8}$`)

  const stripped = normalized
    .split("\n")
    .filter((line) => !revPattern.test(line))
    .map((line) => {
      const match = line.match(refPattern)
      if (!match) {
        return line
      }

      const marker = match[1] ?? ""
      return marker + line.slice(match[0].length)
    })
    .join("\n")

  return lineEnding === "\r\n" ? stripped.replace(/\n/g, "\r\n") : stripped
}

export function buildHashlineSystemInstruction(config: Pick<HashlineRuntimeConfig, "prefix">): string {
  const prefix = config.prefix === false ? "" : config.prefix

  return [
    "## Hashline — Line Reference System",
    "",
    "Use hashline tools only: `hash-read`, `hash-edit`, `hash-patch`, `hash-write`.",
    "",
    `Annotated lines use \`${prefix}<line>#<hash>#<anchor>|<content>\` (example: \`${prefix}12#A3F#9BC|const value = 1\`).`,
    `Read output also includes \`${prefix}REV:<hash>\`; pass that value as \`file_rev\`/\`fileRev\` when editing.`,
    "",
    "### Read first (required before edits)",
    "```json",
    '{ "filePath": "src/app.ts", "offset": 1, "limit": 200 }',
    "```",
    "Use refs exactly as returned, including the anchor hash.",
    "",
    "### Edit with operations[]",
    "```json",
    "{",
    '  "filePath": "src/app.ts",',
    '  "fileRev": "1A2B3C4D",',
    '  "operations": [',
    '    { "op": "replace", "ref": "12#A3F#9BC", "content": "const value = 2" },',
    '    { "op": "insert_after", "ref": "12#A3F#9BC", "content": "console.log(value)" }',
    "  ]",
    "}",
    "```",
    "",
    "### Patch with patch_text JSON",
    "```json",
    '{ "patchText": "{\\"filePath\\":\\"src/app.ts\\",\\"fileRev\\":\\"1A2B3C4D\\",\\"operations\\":[{\\"op\\":\\"replace\\",\\"ref\\":\\"12#A3F#9BC\\",\\"content\\":\\"const value = 2\\"}]}" }',
    "```",
    "`patchText` must be valid JSON (array or object).",
    "",
    "### Write full file content",
    "```json",
    '{ "filePath": "src/app.ts", "fileRev": "1A2B3C4D", "content": "full file contents" }',
    "```",
    "`hash-write` replaces the entire file.",
    "",
    "### Edit single-operation mode",
    "```json",
    "{",
    '  "filePath": "src/app.ts",',
    '  "operation": "replace",',
    '  "startRef": "12#A3F#9BC",',
    '  "endRef": "14#B1C#4DE",',
    '  "replacement": "const value = 3",',
    '  "fileRev": "1A2B3C4D",',
    '  "safeReapply": true',
    "}",
    "```",
    "",
    "After any successful hash-edit/hash-patch/hash-write, run hash-read again before issuing new refs.",
  ].join("\n")
}

interface CacheEntry {
  sourceHash: string
  annotated: string
}

export class HashlineAnnotationCache {
  private readonly entries = new Map<string, CacheEntry>()

  constructor(private readonly maxSize = 100) {}

  get(key: string, source: string): string | null {
    const entry = this.entries.get(key)
    if (!entry) {
      return null
    }

    const currentHash = hashText(source, 12)
    if (entry.sourceHash !== currentHash) {
      this.entries.delete(key)
      return null
    }

    // Refresh LRU order
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.annotated
  }

  set(key: string, source: string, annotated: string): void {
    if (this.entries.has(key)) {
      this.entries.delete(key)
    }

    if (this.entries.size >= this.maxSize) {
      const oldestKey = this.entries.keys().next().value
      if (typeof oldestKey === "string") {
        this.entries.delete(oldestKey)
      }
    }

    this.entries.set(key, {
      sourceHash: hashText(source, 12),
      annotated,
    })
  }

  invalidate(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}

export function extractPathFromToolArgs(args?: Record<string, unknown>): string | undefined {
  if (!args) {
    return undefined
  }

  const candidate = args.path ?? args.filePath ?? args.file_path ?? args.file
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined
}
