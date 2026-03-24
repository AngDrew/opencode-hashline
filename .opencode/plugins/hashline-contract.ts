import { createHash } from "node:crypto"

const SMALL_LINE_HASH_LENGTH = 3
const LARGE_LINE_HASH_LENGTH = 4
const HASH_LENGTH_THRESHOLD = 4096

export const DEFAULT_PREFIX = "#HL"

export const CANONICAL_REF_PATTERN = /^\d+#[A-F0-9]+(?:#[A-F0-9]+)?$/

export const REV_PATTERN = /^[A-F0-9]{8}$/

export interface HashlineRef {
  lineNumber: number
  hash: string
  anchor?: string
}

export interface HashlineReadExample {
  filePath: string
  offset: number
  limit: number
}

export interface HashlineEditOperationExample {
  op: "replace"
  ref: string
  content: string
}

export interface HashlineEditExample {
  filePath: string
  operations: HashlineEditOperationExample[]
}

function hashText(text: string, length = 10): string {
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, length).toUpperCase()
}

function getAdaptiveHashLength(totalLines: number): number {
  return totalLines > HASH_LENGTH_THRESHOLD ? LARGE_LINE_HASH_LENGTH : SMALL_LINE_HASH_LENGTH
}

function hashlineLineHash(line: string, length: number): string {
  return hashText(line, length)
}

function hashlineAnchorHash(
  previousLine: string | undefined,
  line: string,
  nextLine: string | undefined,
  length: number,
): string {
  return hashText(`${previousLine ?? ""}\u241E${line}\u241E${nextLine ?? ""}`, length)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeLineBreaks(content: string): { text: string; eol: "\n" | "\r\n" } {
  const eol: "\n" | "\r\n" = content.includes("\r\n") ? "\r\n" : "\n"
  return {
    text: eol === "\r\n" ? content.replace(/\r\n/g, "\n") : content,
    eol,
  }
}

function restoreLineBreaks(content: string, eol: "\n" | "\r\n"): string {
  return eol === "\r\n" ? content.replace(/\n/g, "\r\n") : content
}

function normalizePrefix(prefix?: string | false): string {
  if (prefix === false) {
    return ""
  }

  return typeof prefix === "string" ? prefix : DEFAULT_PREFIX
}

function stripDiffMarker(line: string): { marker: string; body: string } {
  const marker = line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") ? line[0] : ""
  return {
    marker,
    body: marker ? line.slice(1) : line,
  }
}

function normalizeRefText(refString: string): string {
  let text = refString.trim()

  if (text.length === 0) {
    return text
  }

  if (text.startsWith("+") || text.startsWith("-") || text.startsWith(" ")) {
    text = text.slice(1).trimStart()
  }

  text = text.replace(/^(?:#HL|;;;)\s*/i, "")

  text = text.split("|")[0].trim()
  return text.toUpperCase()
}

function normalizeRevToken(revInput: string): string {
  const text = revInput.trim()
  if (REV_PATTERN.test(text.toUpperCase())) {
    return text.toUpperCase()
  }

  const match = text.match(/^(?:#HL|;;;)?\s*REV:([A-F0-9]{8})$/i)
  if (!match) {
    throw new Error(`Invalid REV token "${revInput}". Expected REV:<8-char hex> or a raw 8-char hash.`)
  }

  return match[1].toUpperCase()
}

function buildPrefixFragment(prefix?: string | false): string {
  const effectivePrefix = normalizePrefix(prefix)
  return effectivePrefix.length > 0 ? `${escapeRegex(effectivePrefix)}\\s*` : ""
}

export function formatRef(lineNumber: number, lineHash: string, anchorHash?: string): string {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    throw new Error(`Invalid line number "${lineNumber}". Expected a positive integer.`)
  }

  const normalizedHash = lineHash.trim().toUpperCase()
  if (!normalizedHash) {
    throw new Error("lineHash is required")
  }

  const normalizedAnchor = typeof anchorHash === "string" && anchorHash.trim().length > 0 ? anchorHash.trim().toUpperCase() : ""
  return normalizedAnchor.length > 0 ? `${lineNumber}#${normalizedHash}#${normalizedAnchor}` : `${lineNumber}#${normalizedHash}`
}

export function formatRev(fileHash: string): string {
  return `REV:${normalizeRev(fileHash)}`
}

export function formatAnnotatedLine(line: string, index: number, lines: string[], prefix?: string | false): string {
  const hashLength = getAdaptiveHashLength(Math.max(1, lines.length))
  const lineHash = hashlineLineHash(line, hashLength)
  const anchorHash = hashlineAnchorHash(lines[index - 1], line, lines[index + 1], hashLength)
  const prefixText = normalizePrefix(prefix)
  const prefixPart = prefixText.length > 0 ? `${prefixText} ` : ""

  return `${prefixPart}${formatRef(index + 1, lineHash, anchorHash)}|${line}`
}

export function parseRef(refString: string): HashlineRef {
  const normalized = normalizeRefText(refString)
  const match = normalized.match(CANONICAL_REF_PATTERN)

  if (!match) {
    throw new Error(
      `Invalid line reference "${refString}". Expected <line>#<hash> or <line>#<hash>#<anchor> (for example: 22#A3F or 22#A3F#9BC).`,
    )
  }

  const [linePart, hashPart, anchorPart] = normalized.split("#")
  const lineNumber = Number.parseInt(linePart, 10)

  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    throw new Error(`Invalid line number in reference "${refString}"`)
  }

  return {
    lineNumber,
    hash: hashPart.toUpperCase(),
    anchor: anchorPart ? anchorPart.toUpperCase() : undefined,
  }
}

export function normalizeRev(revInput: string): string {
  return extractHashFromRev(revInput)
}

export function extractHashFromRev(revToken: string): string {
  return normalizeRevToken(revToken)
}

export function stripHashlinePrefix(content: string, prefix?: string | false): string {
  const { text, eol } = normalizeLineBreaks(content)
  const prefixFragment = buildPrefixFragment(prefix)
  const refPattern = new RegExp(`^([+\\- ])?${prefixFragment}(\\d+)\\s*#\\s*([A-F0-9]+)(?:\\s*#\\s*([A-F0-9]+))?\\|`, "i")

  const stripped = text
    .split("\n")
    .map((line) => {
      const match = line.match(refPattern)
      if (!match) {
        return line
      }

      return `${match[1] ?? ""}${line.slice(match[0].length)}`
    })
    .join("\n")

  return restoreLineBreaks(stripped, eol)
}

export function stripRevLine(content: string, prefix?: string | false): string {
  const { text, eol } = normalizeLineBreaks(content)
  const prefixFragment = buildPrefixFragment(prefix)
  const revPattern = new RegExp(`^([+\\- ])?${prefixFragment}REV:[A-F0-9]{8}$`, "i")

  const stripped = text
    .split("\n")
    .filter((line) => !revPattern.test(line))
    .join("\n")

  return restoreLineBreaks(stripped, eol)
}

export function isValidRef(refString: string): boolean {
  try {
    parseRef(refString)
    return true
  } catch {
    return false
  }
}

export function isValidRev(revString: string): boolean {
  try {
    normalizeRev(revString)
    return true
  } catch {
    return false
  }
}

export function buildReadExample(filePath: string): HashlineReadExample {
  return {
    filePath,
    offset: 1,
    limit: 200,
  }
}

export function buildEditExample(filePath: string, ref: string, content: string): HashlineEditExample {
  return {
    filePath,
    operations: [
      {
        op: "replace",
        ref,
        content,
      },
    ],
  }
}
