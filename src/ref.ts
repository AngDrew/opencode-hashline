import { lineHash, anchorHash } from "./hash.js"

const HASHLINE_PREFIX = "#HL"

export const CANONICAL_REF_PATTERN = /^(\d+)#([A-F0-9]+)(?:#([A-F0-9]+))?$/

export function computeHashes(
  line: string,
  index: number,
  lines: string[],
  hashLength: number,
): { lineHash: string; anchorHash: string } {
  return {
    lineHash: lineHash(line, hashLength),
    anchorHash: anchorHash(lines[index - 1], line, lines[index + 1], hashLength),
  }
}

export function formatRef(lineNumber: number, lineHash: string, anchorHash?: string): string {
  const hash = lineHash.trim().toUpperCase()
  if (!hash) throw new Error("lineHash is required")
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    throw new Error(`Invalid line number ${lineNumber}`)
  }
  const anchor = typeof anchorHash === "string" && anchorHash.trim().length > 0
    ? anchorHash.trim().toUpperCase()
    : ""
  return anchor ? `${lineNumber}#${hash}#${anchor}` : `${lineNumber}#${hash}`
}

export function formatAnnotatedLine(
  line: string,
  index: number,
  lines: string[],
  prefix: string,
  hashLength: number,
): string {
  const lh = computeHashes(line, index, lines, hashLength)
  const prefixPart = prefix ? `${prefix} ` : ""
  return `${prefixPart}${formatRef(index + 1, lh.lineHash, lh.anchorHash)}|${line}`
}

export function parseLineRef(rawRef: string): { lineNumber: number; hash: string; anchor?: string } {
  const trimmed = rawRef.trim()
  const withoutPrefix = trimmed.replace(/^(?:#HL|;;;)\s*/i, "")
  const beforePipe = withoutPrefix.split("|")[0].trim()
  const match = beforePipe.match(/^(\d+)\s*[#: ]\s*([A-Za-z0-9]+)(?:\s*[#: ]\s*([A-Za-z0-9]+))?$/)
  if (!match) {
    throw new Error(
      `Invalid line reference "${rawRef}". Expected <line>#<hash> or <line>#<hash>#<anchor> (example: 22#A3F or 22#A3F#9BC)`,
    )
  }
  const lineNumber = Number.parseInt(match[1], 10)
  if (!Number.isFinite(lineNumber) || lineNumber < 1) {
    throw new Error(`Invalid line number in reference "${rawRef}"`)
  }
  return {
    lineNumber,
    hash: match[2].toUpperCase(),
    anchor: match[3]?.toUpperCase(),
  }
}

export function normalizeLineRef(raw: string): string {
  let ref = raw.trim()
  ref = ref.replace(/^(?:>>>|[+-])\s*/, "")
  const parsed = parseLineRef(ref)
  return formatRef(parsed.lineNumber, parsed.hash, parsed.anchor)
}
