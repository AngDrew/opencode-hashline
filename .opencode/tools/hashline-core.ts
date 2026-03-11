import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"

const DEFAULT_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const SMALL_FILE_HASH_LEN = 3
const LARGE_FILE_HASH_LEN = 4
const HASH_LENGTH_THRESHOLD = 4096

export type HashlineOpName =
  | "replace"
  | "delete"
  | "insert_before"
  | "insert_after"
  | "replace_range"
  | "set_file"

export interface HashlineOperation {
  op: HashlineOpName
  ref?: string
  startRef?: string
  endRef?: string
  content?: string
}

interface FileSnapshot {
  absolutePath: string
  raw: string
  lines: string[]
  eol: "\n" | "\r\n"
  endsWithNewline: boolean
  fileHash: string
}

export interface ParsedHashlineFile {
  raw: string
  lines: string[]
  eol: "\n" | "\r\n"
  endsWithNewline: boolean
  fileHash: string
}

interface ResolvedChange {
  op: HashlineOpName
  spliceStart: number
  deleteCount: number
  insertLines: string[]
  order: number
  anchorIndex?: number
  label: string
}

function hashText(text: string, length = 10): string {
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, length).toUpperCase()
}

export function getAdaptiveHashLength(totalLines: number): number {
  return totalLines > HASH_LENGTH_THRESHOLD ? LARGE_FILE_HASH_LEN : SMALL_FILE_HASH_LEN
}

export function hashlineLineHash(line: string, length = LARGE_FILE_HASH_LEN): string {
  return hashText(line, length)
}

export function hashlineAnchorHash(
  previousLine: string | undefined,
  line: string,
  nextLine: string | undefined,
  length = LARGE_FILE_HASH_LEN,
): string {
  return hashText(`${previousLine ?? ""}\u241E${line}\u241E${nextLine ?? ""}`, length)
}

export function computeFileRev(raw: string): string {
  const normalized = raw.includes("\r\n") ? raw.replace(/\r\n/g, "\n") : raw
  return hashText(normalized, 8)
}

export function parseRaw(raw: string): ParsedHashlineFile {
  const eol: "\n" | "\r\n" = raw.includes("\r\n") ? "\r\n" : "\n"
  const normalized = raw.replace(/\r\n/g, "\n")
  const endsWithNewline = normalized.endsWith("\n")

  let lines: string[] = []
  if (normalized.length > 0) {
    lines = normalized.split("\n")
    if (endsWithNewline) {
      lines.pop()
    }
  }

  return {
    raw,
    lines,
    eol,
    endsWithNewline,
    fileHash: hashText(raw),
  }
}

export function stringifyLines(lines: string[], eol: "\n" | "\r\n", endsWithNewline: boolean): string {
  if (lines.length === 0) {
    return ""
  }

  const body = lines.join(eol)
  return endsWithNewline ? `${body}${eol}` : body
}

export function splitContentToLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n")
  const hasTrailingNewline = normalized.endsWith("\n")
  const parts = normalized.split("\n")

  if (hasTrailingNewline && parts.length > 0) {
    parts.pop()
  }

  return parts
}

export function parseLineRef(rawRef: string): { lineNumber: number; hash: string; anchor?: string } {
  const text = rawRef.trim().replace(/^#HL\s+/i, "")
  const beforePipe = text.split("|")[0].trim()
  const match = beforePipe.match(/^(\d+)\s*[#: ]\s*([A-Za-z0-9]+)(?:\s*[#: ]\s*([A-Za-z0-9]+))?$/)
  if (!match) {
    throw new Error(
      `Invalid line reference "${rawRef}". Expected format: <line>#<hash> or <line>#<hash>#<anchor> (example: 22#A3F or 22#A3F#9BC)`,
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

function resolveRef(ref: string, snapshot: FileSnapshot): { index: number; lineNumber: number } {
  const parsed = parseLineRef(ref)
  if (parsed.lineNumber > snapshot.lines.length) {
    throw new Error(
      `Reference ${ref} points to line ${parsed.lineNumber}, but file only has ${snapshot.lines.length} lines. Read the file again.`,
    )
  }

  const hashLength = getAdaptiveHashLength(snapshot.lines.length)
  const index = parsed.lineNumber - 1
  const actualLine = snapshot.lines[index]
  const actualHash = hashlineLineHash(actualLine, hashLength)
  const actualAnchor = hashlineAnchorHash(snapshot.lines[index - 1], actualLine, snapshot.lines[index + 1], hashLength)

  if (actualHash !== parsed.hash || (parsed.anchor && actualAnchor !== parsed.anchor)) {
    const expectedRef = parsed.anchor
      ? `${parsed.lineNumber}#${parsed.hash}#${parsed.anchor}`
      : `${parsed.lineNumber}#${parsed.hash}`
    const actualRef = `${parsed.lineNumber}#${actualHash}#${actualAnchor}`
    throw new Error(
      `Hash mismatch for line ${parsed.lineNumber}. Expected ${expectedRef}, actual ${actualRef}. Read the file again.`,
    )
  }

  return {
    index,
    lineNumber: parsed.lineNumber,
  }
}

export function resolveFilePath(filePath: string, context?: { directory?: string }): string {
  const baseDirectory = typeof context?.directory === "string" && context.directory.length > 0 ? context.directory : process.cwd()
  return path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(baseDirectory, filePath)
}

async function readSnapshot(absolutePath: string): Promise<FileSnapshot> {
  const raw = await fs.readFile(absolutePath, "utf8")
  const parsed = parseRaw(raw)
  return {
    absolutePath,
    ...parsed,
  }
}

async function readSnapshotIfExists(absolutePath: string): Promise<FileSnapshot | null> {
  try {
    return await readSnapshot(absolutePath)
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT") {
      return null
    }
    throw error
  }
}

function emptySnapshot(absolutePath: string): FileSnapshot {
  return {
    absolutePath,
    raw: "",
    lines: [],
    eol: "\n",
    endsWithNewline: false,
    fileHash: hashText(""),
  }
}

function normalizeOperations(operations: HashlineOperation[]): HashlineOperation[] {
  return operations.map((op) => ({
    op: op.op,
    ref: op.ref?.trim(),
    startRef: op.startRef?.trim(),
    endRef: op.endRef?.trim(),
    content: op.content,
  }))
}

function resolveChanges(snapshot: FileSnapshot, operations: HashlineOperation[]): ResolvedChange[] {
  if (operations.length === 0) {
    throw new Error("No operations provided")
  }

  const setFileCount = operations.filter((op) => op.op === "set_file").length
  if (setFileCount > 0 && operations.length > 1) {
    throw new Error("set_file cannot be combined with other operations")
  }

  return operations.map((op, order): ResolvedChange => {
    switch (op.op) {
      case "replace": {
        if (!op.ref) {
          throw new Error("replace requires ref")
        }
        if (op.content === undefined) {
          throw new Error("replace requires content")
        }

        const resolved = resolveRef(op.ref, snapshot)
        return {
          op: op.op,
          spliceStart: resolved.index,
          deleteCount: 1,
          insertLines: splitContentToLines(op.content),
          order,
          anchorIndex: resolved.index,
          label: `replace(${op.ref})`,
        }
      }

      case "delete": {
        if (!op.ref) {
          throw new Error("delete requires ref")
        }

        const resolved = resolveRef(op.ref, snapshot)
        return {
          op: op.op,
          spliceStart: resolved.index,
          deleteCount: 1,
          insertLines: [],
          order,
          anchorIndex: resolved.index,
          label: `delete(${op.ref})`,
        }
      }

      case "insert_before": {
        if (!op.ref) {
          throw new Error("insert_before requires ref")
        }
        if (op.content === undefined) {
          throw new Error("insert_before requires content")
        }

        const resolved = resolveRef(op.ref, snapshot)
        return {
          op: op.op,
          spliceStart: resolved.index,
          deleteCount: 0,
          insertLines: splitContentToLines(op.content),
          order,
          anchorIndex: resolved.index,
          label: `insert_before(${op.ref})`,
        }
      }

      case "insert_after": {
        if (!op.ref) {
          throw new Error("insert_after requires ref")
        }
        if (op.content === undefined) {
          throw new Error("insert_after requires content")
        }

        const resolved = resolveRef(op.ref, snapshot)
        return {
          op: op.op,
          spliceStart: resolved.index + 1,
          deleteCount: 0,
          insertLines: splitContentToLines(op.content),
          order,
          anchorIndex: resolved.index,
          label: `insert_after(${op.ref})`,
        }
      }

      case "replace_range": {
        if (!op.startRef || !op.endRef) {
          throw new Error("replace_range requires startRef and endRef")
        }
        if (op.content === undefined) {
          throw new Error("replace_range requires content")
        }

        const start = resolveRef(op.startRef, snapshot)
        const end = resolveRef(op.endRef, snapshot)

        if (start.index > end.index) {
          throw new Error("replace_range startRef must be on or before endRef")
        }

        return {
          op: op.op,
          spliceStart: start.index,
          deleteCount: end.index - start.index + 1,
          insertLines: splitContentToLines(op.content),
          order,
          anchorIndex: start.index,
          label: `replace_range(${op.startRef}..${op.endRef})`,
        }
      }

      case "set_file": {
        if (op.content === undefined) {
          throw new Error("set_file requires content")
        }

        return {
          op: op.op,
          spliceStart: 0,
          deleteCount: snapshot.lines.length,
          insertLines: splitContentToLines(op.content),
          order,
          anchorIndex: undefined,
          label: "set_file",
        }
      }

      default:
        throw new Error(`Unsupported operation: ${(op as { op?: string }).op ?? "unknown"}`)
    }
  })
}

function validateChangeConflicts(changes: ResolvedChange[]): void {
  const consumed = new Map<number, string>()

  for (const change of changes) {
    if (change.deleteCount === 0) {
      continue
    }

    for (let idx = change.spliceStart; idx < change.spliceStart + change.deleteCount; idx += 1) {
      const existing = consumed.get(idx)
      if (existing) {
        throw new Error(`Overlapping operations are not allowed: ${change.label} conflicts with ${existing}`)
      }
      consumed.set(idx, change.label)
    }
  }

  for (const change of changes) {
    if (change.deleteCount !== 0 || change.anchorIndex === undefined) {
      continue
    }

    const existing = consumed.get(change.anchorIndex)
    if (existing) {
      throw new Error(`Operation conflict: ${change.label} references a line already modified by ${existing}`)
    }
  }
}

function applyChanges(snapshot: FileSnapshot, changes: ResolvedChange[]): { lines: string[]; additions: number; removals: number } {
  const nextLines = [...snapshot.lines]
  const ordered = [...changes].sort((a, b) => {
    if (a.spliceStart !== b.spliceStart) {
      return b.spliceStart - a.spliceStart
    }
    return b.order - a.order
  })

  let additions = 0
  let removals = 0

  for (const change of ordered) {
    additions += change.insertLines.length
    removals += change.deleteCount
    nextLines.splice(change.spliceStart, change.deleteCount, ...change.insertLines)
  }

  return {
    lines: nextLines,
    additions,
    removals,
  }
}

function snapshotFromLines(base: FileSnapshot, nextLines: string[]): FileSnapshot {
  const nextRaw = stringifyLines(nextLines, base.eol, base.endsWithNewline)
  const parsed = parseRaw(nextRaw)
  return {
    absolutePath: base.absolutePath,
    ...parsed,
  }
}

async function writeSnapshot(snapshot: FileSnapshot): Promise<void> {
  await fs.mkdir(path.dirname(snapshot.absolutePath), { recursive: true })
  await fs.writeFile(snapshot.absolutePath, snapshot.raw, "utf8")
}

function formatEditResult(params: {
  filePath: string
  mode: "hashline" | "legacy"
  dryRun: boolean
  before: FileSnapshot
  after: FileSnapshot
  operations: number
  additions: number
  removals: number
}): string {
  return [
    `Hashline ${params.mode} edit ${params.dryRun ? "(dry run) " : ""}completed for ${params.filePath}.`,
    `File hash: ${params.before.fileHash} -> ${params.after.fileHash}`,
    `Operations: ${params.operations}; additions: ${params.additions}; removals: ${params.removals}`,
    `Lines: ${params.before.lines.length} -> ${params.after.lines.length}`,
    "Read the file again before issuing additional hashline refs.",
  ].join("\n")
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0
  }

  let count = 0
  let from = 0

  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) {
      return count
    }

    count += 1
    from = idx + needle.length
  }
}

export async function runHashlineRead(params: {
  filePath: string
  offset?: number
  limit?: number
  context?: { directory?: string }
}): Promise<string> {
  const absolutePath = resolveFilePath(params.filePath, params.context)
  const snapshot = await readSnapshot(absolutePath)

  const startLine = Math.max(1, Math.floor(params.offset ?? 1))
  const limit = Math.max(1, Math.floor(params.limit ?? DEFAULT_LIMIT))

  const startIndex = startLine - 1
  const endIndex = Math.min(snapshot.lines.length, startIndex + limit)
  const hashLength = getAdaptiveHashLength(snapshot.lines.length)
  const body: string[] = []

  body.push(`#HL REV:${computeFileRev(snapshot.raw)}`)

  for (let idx = startIndex; idx < endIndex; idx += 1) {
    const line = snapshot.lines[idx]
    const displayLine = line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line
    const lineHash = hashlineLineHash(line, hashLength)
    const anchorHash = hashlineAnchorHash(snapshot.lines[idx - 1], line, snapshot.lines[idx + 1], hashLength)
    const ref = `${idx + 1}#${lineHash}#${anchorHash}`
    body.push(`#HL ${ref}|${displayLine}`)
  }

  if (snapshot.lines.length === 0) {
    body.push("# file is empty")
  }

  if (startIndex > 0) {
    body.unshift(`# skipped lines: 1-${startIndex}`)
  }
  if (endIndex < snapshot.lines.length) {
    body.push(`# truncated: ${snapshot.lines.length - endIndex} lines not shown`)
  }

  return [
    `<hashline-file path="${absolutePath}" file_hash="${snapshot.fileHash}" total_lines="${snapshot.lines.length}" start_line="${startLine}" shown_until="${endIndex}">`,
    "# format: <line>#<hash>#<anchor>|<content>",
    "# use refs exactly as shown in hashline edit/patch tools",
    ...body,
    "</hashline-file>",
  ].join("\n")
}

export async function runHashlineOperations(params: {
  filePath: string
  operations: HashlineOperation[]
  expectedFileHash?: string
  fileRev?: string
  dryRun?: boolean
  context?: { directory?: string }
}): Promise<string> {
  const absolutePath = resolveFilePath(params.filePath, params.context)
  const existingSnapshot = await readSnapshotIfExists(absolutePath)

  const snapshot = existingSnapshot ?? emptySnapshot(absolutePath)
  const normalizedOps = normalizeOperations(params.operations)

  if (params.expectedFileHash && snapshot.fileHash !== params.expectedFileHash.toUpperCase()) {
    throw new Error(
      `File hash mismatch for ${params.filePath}. Expected ${params.expectedFileHash.toUpperCase()}, actual ${snapshot.fileHash}. Read the file again before editing.`,
    )
  }

  if (params.fileRev) {
    const expectedRev = params.fileRev.toUpperCase()
    const actualRev = computeFileRev(snapshot.raw)
    if (actualRev !== expectedRev) {
      throw new Error(
        `File revision mismatch for ${params.filePath}. Expected ${expectedRev}, actual ${actualRev}. Read the file again before editing.`,
      )
    }
  }

  const changes = resolveChanges(snapshot, normalizedOps)
  validateChangeConflicts(changes)

  const applied = applyChanges(snapshot, changes)
  const after = snapshotFromLines(snapshot, applied.lines)

  if (!params.dryRun) {
    await writeSnapshot(after)
  }

  return formatEditResult({
    filePath: params.filePath,
    mode: "hashline",
    dryRun: Boolean(params.dryRun),
    before: snapshot,
    after,
    operations: normalizedOps.length,
    additions: applied.additions,
    removals: applied.removals,
  })
}

export async function runLegacyEdit(params: {
  filePath: string
  oldString?: string
  newString?: string
  expectedFileHash?: string
  fileRev?: string
  dryRun?: boolean
  context?: { directory?: string }
}): Promise<string> {
  const absolutePath = resolveFilePath(params.filePath, params.context)
  const existingSnapshot = await readSnapshotIfExists(absolutePath)
  const snapshot = existingSnapshot ?? emptySnapshot(absolutePath)

  if (params.expectedFileHash && snapshot.fileHash !== params.expectedFileHash.toUpperCase()) {
    throw new Error(
      `File hash mismatch for ${params.filePath}. Expected ${params.expectedFileHash.toUpperCase()}, actual ${snapshot.fileHash}. Read the file again before editing.`,
    )
  }

  if (params.fileRev) {
    const expectedRev = params.fileRev.toUpperCase()
    const actualRev = computeFileRev(snapshot.raw)
    if (actualRev !== expectedRev) {
      throw new Error(
        `File revision mismatch for ${params.filePath}. Expected ${expectedRev}, actual ${actualRev}. Read the file again before editing.`,
      )
    }
  }

  const oldString = params.oldString ?? ""
  const newString = params.newString ?? ""
  let nextRaw = snapshot.raw

  if (oldString.length === 0) {
    nextRaw = newString
  } else {
    const occurrences = countOccurrences(snapshot.raw, oldString)
    if (occurrences === 0) {
      throw new Error("old_string was not found in file")
    }
    if (occurrences > 1) {
      throw new Error("old_string must match exactly one location")
    }

    const start = snapshot.raw.indexOf(oldString)
    nextRaw = `${snapshot.raw.slice(0, start)}${newString}${snapshot.raw.slice(start + oldString.length)}`
  }

  const parsed = parseRaw(nextRaw)
  const after: FileSnapshot = {
    absolutePath,
    ...parsed,
  }

  if (!params.dryRun) {
    await writeSnapshot(after)
  }

  return formatEditResult({
    filePath: params.filePath,
    mode: "legacy",
    dryRun: Boolean(params.dryRun),
    before: snapshot,
    after,
    operations: 1,
    additions: Math.max(0, after.lines.length - snapshot.lines.length),
    removals: Math.max(0, snapshot.lines.length - after.lines.length),
  })
}

export function parsePatchText(patchText: string): {
  filePath?: string
  operations?: HashlineOperation[]
  expectedFileHash?: string
  fileRev?: string
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(patchText)
  } catch {
    throw new Error(
      "patch_text must be JSON for hashline patching. Use either an array of operations or an object { file_path, operations, expected_file_hash }.",
    )
  }

  if (Array.isArray(parsed)) {
    return {
      operations: parsed as HashlineOperation[],
    }
  }

  if (parsed && typeof parsed === "object") {
    const obj = parsed as {
      file_path?: string
      filePath?: string
      operations?: HashlineOperation[]
      expected_file_hash?: string
      expectedFileHash?: string
      file_rev?: string
      fileRev?: string
    }
    return {
      filePath: obj.file_path ?? obj.filePath,
      operations: obj.operations,
      expectedFileHash: obj.expected_file_hash ?? obj.expectedFileHash,
      fileRev: obj.file_rev ?? obj.fileRev,
    }
  }

  throw new Error("patch_text JSON must be an array or object")
}

export type HashlineOperationInput = {
  op: HashlineOpName
  ref?: string
  start_ref?: string
  end_ref?: string
  content?: string
}

export function mapOperationInput(input: HashlineOperationInput): HashlineOperation {
  return {
    op: input.op,
    ref: input.ref,
    startRef: input.start_ref,
    endRef: input.end_ref,
    content: input.content,
  }
}
