import { getAdaptiveHashLength, lineHash, anchorHash } from "./hash.js"
import { parseLineRef, normalizeLineRef } from "./ref.js"

export interface HashlineEdit {
  op: "replace" | "append" | "prepend"
  pos?: string
  end?: string
  lines: string[] | string | null
}

export interface EditReport {
  content: string
  noopEdits: number
  deduplicatedEdits: number
}

export class HashlineMismatchError extends Error {
  readonly remaps: Map<string, string>

  constructor(
    private readonly mismatches: Array<{ line: number; expected: string }>,
    private readonly fileLines: string[],
  ) {
    super(HashlineMismatchError.formatMessage(mismatches, fileLines))
    this.name = "HashlineMismatchError"
    const remaps = new Map<string, string>()
    const hashLen = getAdaptiveHashLength(fileLines.length)
    for (const m of mismatches) {
      const actual = lineHash(fileLines[m.line - 1] ?? "", hashLen)
      remaps.set(`${m.line}#${m.expected}`, `${m.line}#${actual}`)
    }
    this.remaps = remaps
  }

  private static formatMessage(
    mismatches: Array<{ line: number; expected: string }>,
    fileLines: string[],
  ): string {
    const ctx = 2
    const display = new Set<number>()
    for (const m of mismatches) {
      const lo = Math.max(1, m.line - ctx)
      const hi = Math.min(fileLines.length, m.line + ctx)
      for (let l = lo; l <= hi; l++) display.add(l)
    }
    const sorted = [...display].sort((a, b) => a - b)
    const lines: string[] = [
      `${mismatches.length} line${mismatches.length > 1 ? "s have" : " has"} changed since last read. Use updated LINE#ID references below (>>> marks changed lines).`,
      "",
    ]
    const hashLen = getAdaptiveHashLength(fileLines.length)
    let prev = -1
    for (const line of sorted) {
      if (prev !== -1 && line > prev + 1) lines.push("    ...")
      prev = line
      const content = fileLines[line - 1] ?? ""
      const hash = lineHash(content, hashLen)
      const prefix = mismatches.some((m) => m.line === line) ? ">>> " : "    "
      lines.push(`${prefix}${line}#${hash}#${anchorHash(fileLines[line - 2], content, fileLines[line], hashLen)}|${content}`)
    }
    return lines.join("\n")
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function toLines(content: string): string[] {
  return content.length === 0 ? [] : content.split("\n")
}

function getEditLineNumber(edit: HashlineEdit): number {
  if (edit.pos) {
    const parsed = parseLineRef(edit.pos)
    return parsed.lineNumber
  }
  if (edit.op === "append") return Infinity
  return 0
}

function collectLineRefs(edits: HashlineEdit[]): string[] {
  const refs: string[] = []
  for (const edit of edits) {
    if (edit.pos) refs.push(normalizeLineRef(edit.pos))
    if (edit.end) refs.push(normalizeLineRef(edit.end))
  }
  return refs
}

function resolveRefLine(ref: string): number {
  return parseLineRef(ref).lineNumber
}

function validateRef(lines: string[], ref: string): void {
  const parsed = parseLineRef(ref)
  if (parsed.lineNumber < 1 || parsed.lineNumber > lines.length) {
    throw new Error(`Line ${parsed.lineNumber} out of bounds (file has ${lines.length} lines)`)
  }
  const hashLen = getAdaptiveHashLength(lines.length)
  const idx = parsed.lineNumber - 1
  const actual = lineHash(lines[idx], hashLen)
  if (actual !== parsed.hash) {
    throw new HashlineMismatchError(
      [{ line: parsed.lineNumber, expected: parsed.hash }],
      lines,
    )
  }
  if (parsed.anchor) {
    const actualAnchor = anchorHash(lines[idx - 1], lines[idx], lines[idx + 1], hashLen)
    if (actualAnchor !== parsed.anchor) {
      throw new HashlineMismatchError(
        [{ line: parsed.lineNumber, expected: parsed.hash }],
        lines,
      )
    }
  }
}

function validateRefs(lines: string[], refs: string[]): void {
  const mismatches: Array<{ line: number; expected: string }> = []
  const hashLen = getAdaptiveHashLength(lines.length)
  for (const ref of refs) {
    const parsed = parseLineRef(ref)
    if (parsed.lineNumber < 1 || parsed.lineNumber > lines.length) {
      throw new Error(`Line ${parsed.lineNumber} out of bounds (file has ${lines.length} lines)`)
    }
    const idx = parsed.lineNumber - 1
    const actual = lineHash(lines[idx], hashLen)
    if (actual !== parsed.hash) {
      mismatches.push({ line: parsed.lineNumber, expected: parsed.hash })
    } else if (parsed.anchor) {
      const actualAnchor = anchorHash(lines[idx - 1], lines[idx], lines[idx + 1], hashLen)
      if (actualAnchor !== parsed.anchor) {
        mismatches.push({ line: parsed.lineNumber, expected: parsed.hash })
      }
    }
  }
  if (mismatches.length > 0) throw new HashlineMismatchError(mismatches, lines)
}

function applySetLine(lines: string[], pos: string, replacement: string[]): string[] {
  const line = resolveRefLine(pos)
  const idx = line - 1
  const result = [...lines]
  if (arraysEqual([result[idx]], replacement)) return lines
  result.splice(idx, 1, ...replacement)
  return result
}

function applyReplaceRange(lines: string[], start: string, end: string, replacement: string[]): string[] {
  const s = resolveRefLine(start) - 1
  const e = resolveRefLine(end) - 1
  if (s > e) throw new Error("replace_range start must be before end")
  const result = [...lines]
  const removed = result.slice(s, e + 1)
  if (arraysEqual(removed, replacement)) return lines
  result.splice(s, e - s + 1, ...replacement)
  return result
}

function applyInsertAfter(lines: string[], anchor: string, insert: string[]): string[] {
  const idx = resolveRefLine(anchor)
  const result = [...lines]
  result.splice(idx, 0, ...insert)
  return result
}

function applyInsertBefore(lines: string[], anchor: string, insert: string[]): string[] {
  const idx = resolveRefLine(anchor) - 1
  const result = [...lines]
  result.splice(idx, 0, ...insert)
  return result
}

function applyAppend(lines: string[], insert: string[]): string[] {
  return [...lines, ...insert]
}

function applyPrepend(lines: string[], insert: string[]): string[] {
  return [...insert, ...lines]
}

function dedupeEdits(edits: HashlineEdit[]): { edits: HashlineEdit[]; deduplicatedEdits: number } {
  const seen = new Map<string, HashlineEdit>()
  const result: HashlineEdit[] = []
  let dedups = 0
  for (const edit of edits) {
    if (edit.op === "replace" && edit.pos) {
      const key = `${edit.op}:${edit.pos}`
      if (seen.has(key)) { dedups++; continue }
      seen.set(key, edit)
      result.push(edit)
    } else {
      result.push(edit)
    }
  }
  return { edits: result, deduplicatedEdits: dedups }
}

function detectOverlappingRanges(edits: HashlineEdit[]): string | null {
  const ranges: Array<[number, number, string]> = []
  for (const edit of edits) {
    if (edit.op !== "replace") continue
    if (!edit.pos && !edit.end) continue
    const start = edit.pos ? resolveRefLine(edit.pos) - 1 : 0
    const end = edit.end ? resolveRefLine(edit.end) - 1 : start
    for (const [rs, re, label] of ranges) {
      if (start <= re && end >= rs) {
        return `Overlapping operations: ${label} conflicts with edits on lines ${rs + 1}-${re + 1}`
      }
    }
    ranges.push([start, end, `${start + 1}#${edit.end ? edit.end.split("#")[1] : edit.pos?.split("#")[1] ?? ""}`])
  }
  return null
}

function toLinesArray(edit: HashlineEdit): string[] {
  if (edit.lines === null || edit.lines === undefined) return []
  if (Array.isArray(edit.lines)) return edit.lines
  if (typeof edit.lines === "string" && edit.lines.length === 0) return []
  if (typeof edit.lines === "string") return edit.lines.split("\n")
  return []
}

export function applyHashlineEdits(content: string, edits: HashlineEdit[]): EditReport {
  if (edits.length === 0) return { content, noopEdits: 0, deduplicatedEdits: 0 }

  const deduped = dedupeEdits(edits)
  const EDIT_PRECEDENCE: Record<string, number> = { replace: 0, append: 1, prepend: 2 }
  const sorted = [...deduped.edits].sort((a, b) => {
    const la = getEditLineNumber(a)
    const lb = getEditLineNumber(b)
    if (lb !== la) return lb - la
    return (EDIT_PRECEDENCE[a.op] ?? 3) - (EDIT_PRECEDENCE[b.op] ?? 3)
  })

  let noopEdits = 0
  let lines = toLines(content)
  const refs = collectLineRefs(sorted)
  validateRefs(lines, refs)
  const overlap = detectOverlappingRanges(sorted)
  if (overlap) throw new Error(overlap)

  for (const edit of sorted) {
    const insert = toLinesArray(edit)
    let next: string[]
    switch (edit.op) {
      case "replace":
        if (edit.pos && edit.end) {
          next = applyReplaceRange(lines, edit.pos, edit.end, insert)
        } else if (edit.pos) {
          next = applySetLine(lines, edit.pos, insert)
        } else {
          throw new Error("replace requires pos")
        }
        break
      case "append":
        next = edit.pos ? applyInsertAfter(lines, edit.pos, insert) : applyAppend(lines, insert)
        break
      case "prepend":
        next = edit.pos ? applyInsertBefore(lines, edit.pos, insert) : applyPrepend(lines, insert)
        break
      default:
        throw new Error(`Unsupported op: ${(edit as any).op}`)
    }
    if (arraysEqual(next, lines)) {
      noopEdits++
    } else {
      lines = next
    }
  }

  return {
    content: lines.join("\n"),
    noopEdits,
    deduplicatedEdits: deduped.deduplicatedEdits,
  }
}
