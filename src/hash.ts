import { createHash } from "node:crypto"

const SMALL_LEN = 3
const LARGE_LEN = 4
const THRESHOLD = 4096
const REV_LEN = 8

function hashText(text: string, length: number): string {
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, length).toUpperCase()
}

export function getAdaptiveHashLength(totalLines: number): number {
  return totalLines > THRESHOLD ? LARGE_LEN : SMALL_LEN
}

export function lineHash(line: string, length?: number): string {
  return hashText(line, length ?? LARGE_LEN)
}

export function anchorHash(
  previousLine: string | undefined,
  currentLine: string,
  nextLine: string | undefined,
  hashLength?: number,
): string {
  return hashText(
    `${previousLine ?? ""}\u241E${currentLine}\u241E${nextLine ?? ""}`,
    hashLength ?? LARGE_LEN,
  )
}

export function computeFileRev(raw: string): string {
  const normalized = raw.includes("\r\n") ? raw.replace(/\r\n/g, "\n") : raw
  return hashText(normalized, REV_LEN)
}

export function formatHashLine(
  lineIndex: number,
  line: string,
  lines: string[],
  prefix: string,
): string {
  const hashLen = getAdaptiveHashLength(lines.length)
  const lh = lineHash(line, hashLen)
  const ah = anchorHash(lines[lineIndex - 1], line, lines[lineIndex + 1], hashLen)
  return `${prefix} ${lineIndex + 1}#${lh}#${ah}|${line}`
}
