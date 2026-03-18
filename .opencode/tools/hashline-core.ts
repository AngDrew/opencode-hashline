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

interface HashlineMetadataInput {
  title?: string
  metadata?: {
    [key: string]: any
  }
}

interface HashlineToolContext {
  directory?: string
  metadata?: (input: HashlineMetadataInput) => void
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

function assertFileRevisionMatches(snapshot: FileSnapshot, filePath: string, providedFileRev?: string): void {
  if (typeof providedFileRev !== "string") {
    return
  }

  const expectedToken = providedFileRev.trim().toUpperCase()
  if (expectedToken.length === 0) {
    return
  }

  const actualRev = computeFileRev(snapshot.raw)
  if (expectedToken === actualRev) {
    return
  }

  // Compatibility hardening for smaller models: they sometimes pass `file_hash`
  // (10 chars from the <hashline-file ... file_hash="..."> header) into `fileRev`.
  if (expectedToken === snapshot.fileHash) {
    return
  }

  throw new Error(
    `File revision mismatch for ${filePath}. Expected ${expectedToken}, actual ${actualRev}. Read the file again before editing.`,
  )
}

export function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  }

  return undefined
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

interface RefCandidate {
  index: number
  lineNumber: number
}

function findRefCandidates(
  parsed: { lineNumber: number; hash: string; anchor?: string },
  snapshot: FileSnapshot,
  hashLength: number,
): RefCandidate[] {
  const candidates: RefCandidate[] = []

  for (let idx = 0; idx < snapshot.lines.length; idx += 1) {
    const line = snapshot.lines[idx]
    const lineHash = hashlineLineHash(line, hashLength)
    if (lineHash !== parsed.hash) {
      continue
    }

    if (parsed.anchor) {
      const anchorHash = hashlineAnchorHash(snapshot.lines[idx - 1], line, snapshot.lines[idx + 1], hashLength)
      if (anchorHash !== parsed.anchor) {
        continue
      }
    }

    candidates.push({
      index: idx,
      lineNumber: idx + 1,
    })
  }

  return candidates
}

function resolveRef(ref: string, snapshot: FileSnapshot, safeReapply = false): { index: number; lineNumber: number } {
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
    if (safeReapply) {
      const candidates = findRefCandidates(parsed, snapshot, hashLength)
      if (candidates.length === 1) {
        return {
          index: candidates[0].index,
          lineNumber: candidates[0].lineNumber,
        }
      }

      if (candidates.length > 1) {
        const candidateLines = candidates.map((candidate) => candidate.lineNumber).join(", ")
        throw new Error(
          `Hash mismatch for line ${parsed.lineNumber}; found multiple relocation candidates (${candidateLines}). Read the file again.`,
        )
      }

      throw new Error(`Hash mismatch for line ${parsed.lineNumber}; no relocation candidates found. Read the file again.`)
    }

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

function areEquivalentRefs(a: string, b: string): boolean {
  try {
    const parsedA = parseLineRef(a)
    const parsedB = parseLineRef(b)

    if (parsedA.lineNumber !== parsedB.lineNumber || parsedA.hash !== parsedB.hash) {
      return false
    }

    // If both include anchors, they must also match. If only one side has an
    // anchor, treat them as equivalent (same line/hash target).
    if (parsedA.anchor && parsedB.anchor && parsedA.anchor !== parsedB.anchor) {
      return false
    }

    return true
  } catch {
    return a.trim() === b.trim()
  }
}

function resolveRefRange(params: {
  snapshot: FileSnapshot
  ref?: string
  startRef?: string
  endRef?: string
  safeReapply: boolean
  label: string
}): { start: { index: number; lineNumber: number }; end: { index: number; lineNumber: number } } {
  const ref = params.ref?.trim()
  const startRef = params.startRef?.trim()
  const endRef = params.endRef?.trim()

  if (ref && startRef && !areEquivalentRefs(ref, startRef)) {
    throw new Error(`${params.label} accepts either ref or startRef/endRef, not both`)
  }

  const baseStartRef = startRef ?? ref
  if (!baseStartRef) {
    throw new Error(`${params.label} requires ref or startRef`)
  }

  let start = resolveRef(baseStartRef, params.snapshot, params.safeReapply)
  let end = endRef ? resolveRef(endRef, params.snapshot, params.safeReapply) : start

  if (start.index > end.index) {
    const first = start
    start = end
    end = first
  }

  return {
    start,
    end,
  }
}

function resolveChanges(snapshot: FileSnapshot, operations: HashlineOperation[], safeReapply: boolean): ResolvedChange[] {
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
        if (op.content === undefined) {
          throw new Error("replace requires content")
        }

        const resolvedRange = resolveRefRange({
          snapshot,
          ref: op.ref,
          startRef: op.startRef,
          endRef: op.endRef,
          safeReapply,
          label: "replace",
        })
        return {
          op: op.op,
          spliceStart: resolvedRange.start.index,
          deleteCount: resolvedRange.end.index - resolvedRange.start.index + 1,
          insertLines: splitContentToLines(op.content),
          order,
          anchorIndex: resolvedRange.start.index,
          label:
            op.startRef || op.endRef
              ? `replace(${op.startRef ?? op.ref}..${op.endRef ?? op.startRef ?? op.ref})`
              : `replace(${op.ref})`,
        }
      }

      case "delete": {
        const resolvedRange = resolveRefRange({
          snapshot,
          ref: op.ref,
          startRef: op.startRef,
          endRef: op.endRef,
          safeReapply,
          label: "delete",
        })
        return {
          op: op.op,
          spliceStart: resolvedRange.start.index,
          deleteCount: resolvedRange.end.index - resolvedRange.start.index + 1,
          insertLines: [],
          order,
          anchorIndex: resolvedRange.start.index,
          label:
            op.startRef || op.endRef
              ? `delete(${op.startRef ?? op.ref}..${op.endRef ?? op.startRef ?? op.ref})`
              : `delete(${op.ref})`,
        }
      }

      case "insert_before": {
        if (op.content === undefined) {
          throw new Error("insert_before requires content")
        }

        const resolvedRange = resolveRefRange({
          snapshot,
          ref: op.ref,
          startRef: op.startRef,
          endRef: op.endRef,
          safeReapply,
          label: "insert_before",
        })
        return {
          op: op.op,
          spliceStart: resolvedRange.start.index,
          deleteCount: 0,
          insertLines: splitContentToLines(op.content),
          order,
          anchorIndex: resolvedRange.start.index,
          label:
            op.startRef || op.endRef
              ? `insert_before(${op.startRef ?? op.ref}..${op.endRef ?? op.startRef ?? op.ref})`
              : `insert_before(${op.ref})`,
        }
      }

      case "insert_after": {
        if (op.content === undefined) {
          throw new Error("insert_after requires content")
        }

        const resolvedRange = resolveRefRange({
          snapshot,
          ref: op.ref,
          startRef: op.startRef,
          endRef: op.endRef,
          safeReapply,
          label: "insert_after",
        })
        return {
          op: op.op,
          spliceStart: resolvedRange.end.index + 1,
          deleteCount: 0,
          insertLines: splitContentToLines(op.content),
          order,
          anchorIndex: resolvedRange.end.index,
          label:
            op.startRef || op.endRef
              ? `insert_after(${op.startRef ?? op.ref}..${op.endRef ?? op.startRef ?? op.ref})`
              : `insert_after(${op.ref})`,
        }
      }

      case "replace_range": {
        if (!op.startRef || !op.endRef) {
          throw new Error("replace_range requires startRef and endRef")
        }
        if (op.content === undefined) {
          throw new Error("replace_range requires content")
        }

        const start = resolveRef(op.startRef, snapshot, safeReapply)
        const end = resolveRef(op.endRef, snapshot, safeReapply)

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

const MAX_DIFF_PREVIEW_HUNKS = 24
const MAX_DIFF_PREVIEW_LINES = 240
const MAX_DIFF_PREVIEW_LINE_LENGTH = 500

function truncateDiffLine(line: string): string {
  return line.length > MAX_DIFF_PREVIEW_LINE_LENGTH ? `${line.slice(0, MAX_DIFF_PREVIEW_LINE_LENGTH)}…` : line
}

function buildOperationDiffLines(
  snapshot: FileSnapshot,
  changes: ResolvedChange[],
  params: {
    fenced: boolean
    filePath?: string
    maxHunks: number
    maxLines: number
    truncationNotice: string
  },
): string[] | undefined {
  if (changes.length === 0) {
    return undefined
  }

  const sorted = [...changes].sort((a, b) => {
    if (a.spliceStart !== b.spliceStart) {
      return a.spliceStart - b.spliceStart
    }
    return a.order - b.order
  })

  const lines: string[] = []
  let emitted = 0
  let delta = 0
  let truncated = false
  const maxHunks = Math.min(sorted.length, params.maxHunks)

  if (params.fenced) {
    lines.push("```diff")
  }

  if (params.filePath) {
    const normalizedPath = params.filePath.replace(/\\/g, "/").replace(/^\/+/, "")
    lines.push(`--- a/${normalizedPath}`, `+++ b/${normalizedPath}`)
  }

  for (let idx = 0; idx < maxHunks; idx += 1) {
    const change = sorted[idx]
    const removed = snapshot.lines.slice(change.spliceStart, change.spliceStart + change.deleteCount)
    const added = change.insertLines

    const beforeStart = change.spliceStart + 1
    const afterStart = change.spliceStart + 1 + delta
    lines.push(`@@ -${beforeStart},${removed.length} +${afterStart},${added.length} @@ ${change.label}`)

    for (const removedLine of removed) {
      if (emitted >= params.maxLines) {
        truncated = true
        break
      }
      lines.push(`-${truncateDiffLine(removedLine)}`)
      emitted += 1
    }

    if (truncated) {
      break
    }

    for (const addedLine of added) {
      if (emitted >= params.maxLines) {
        truncated = true
        break
      }
      lines.push(`+${truncateDiffLine(addedLine)}`)
      emitted += 1
    }

    if (truncated) {
      break
    }

    delta += added.length - removed.length
  }

  if (sorted.length > maxHunks) {
    truncated = true
  }

  if (truncated) {
    lines.push(params.truncationNotice)
  }

  if (params.fenced) {
    lines.push("```")
  }

  return lines
}

function buildOperationDiffPreview(snapshot: FileSnapshot, changes: ResolvedChange[]): string | undefined {
  const lines = buildOperationDiffLines(snapshot, changes, {
    fenced: true,
    maxHunks: MAX_DIFF_PREVIEW_HUNKS,
    maxLines: MAX_DIFF_PREVIEW_LINES,
    truncationNotice: "# …diff preview truncated",
  })
  return lines?.join("\n")
}

function buildOperationUnifiedDiff(snapshot: FileSnapshot, changes: ResolvedChange[], filePath: string): string | undefined {
  const lines = buildOperationDiffLines(snapshot, changes, {
    fenced: false,
    filePath,
    maxHunks: 120,
    maxLines: 2000,
    truncationNotice: "# diff truncated",
  })
  return lines?.join("\n")
}

function emitHashlineOperationMetadata(params: {
  filePath: string
  dryRun: boolean
  before: FileSnapshot
  after: FileSnapshot
  operations: number
  additions: number
  removals: number
  existed: boolean
  diff?: string
  diffPreview?: string
  context?: HashlineToolContext
}): void {
  params.context?.metadata?.({
    title: `Hashline ${params.dryRun ? "preview" : "edit"} ${params.filePath}`,
    metadata: {
      filepath: params.filePath,
      exists: params.existed,
      diff: params.diff,
      diffPreview: params.diffPreview,
      filediff: {
        additions: params.additions,
        deletions: params.removals,
      },
      files: [
        {
          filepath: params.filePath,
          exists: params.existed,
          diff: params.diff,
          filediff: {
            additions: params.additions,
            deletions: params.removals,
          },
        },
      ],
      hashline: {
        dryRun: params.dryRun,
        operations: params.operations,
        fileHashBefore: params.before.fileHash,
        fileHashAfter: params.after.fileHash,
        fileRevBefore: computeFileRev(params.before.raw),
        fileRevAfter: computeFileRev(params.after.raw),
      },
    },
  })
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
  diffPreview?: string
}): string {
  const body = [
    `Hashline ${params.mode} edit ${params.dryRun ? "(dry run) " : ""}completed for ${params.filePath}.`,
    `File hash: ${params.before.fileHash} -> ${params.after.fileHash}`,
    `Operations: ${params.operations}; additions: ${params.additions}; removals: ${params.removals}`,
    `Lines: ${params.before.lines.length} -> ${params.after.lines.length}`,
  ]

  if (params.diffPreview) {
    body.push("Diff preview:", params.diffPreview)
  }

  body.push("Read the file again before issuing additional hashline refs.")
  return body.join("\n")
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
  safeReapply?: boolean
  dryRun?: boolean
  context?: HashlineToolContext
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

  assertFileRevisionMatches(snapshot, params.filePath, params.fileRev)

  const changes = resolveChanges(snapshot, normalizedOps, Boolean(params.safeReapply))
  validateChangeConflicts(changes)

  const applied = applyChanges(snapshot, changes)
  const after = snapshotFromLines(snapshot, applied.lines)
  const diffPreview = buildOperationDiffPreview(snapshot, changes)
  const diff = buildOperationUnifiedDiff(snapshot, changes, params.filePath)

  if (!params.dryRun) {
    await writeSnapshot(after)
  }

  emitHashlineOperationMetadata({
    filePath: params.filePath,
    dryRun: Boolean(params.dryRun),
    before: snapshot,
    after,
    operations: normalizedOps.length,
    additions: applied.additions,
    removals: applied.removals,
    existed: Boolean(existingSnapshot),
    diff,
    diffPreview,
    context: params.context,
  })

  return formatEditResult({
    filePath: params.filePath,
    mode: "hashline",
    dryRun: Boolean(params.dryRun),
    before: snapshot,
    after,
    operations: normalizedOps.length,
    additions: applied.additions,
    removals: applied.removals,
    diffPreview,
  })
}

export async function runHashlineCheck(params: {
  filePath: string
  targets?: Array<{
    op?: HashlineOpName
    ref?: string
    startRef?: string
    endRef?: string
  }>
  expectedFileHash?: string
  fileRev?: string
  safeReapply?: boolean
  verbose?: boolean
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

  assertFileRevisionMatches(snapshot, params.filePath, params.fileRev)

  const safeReapply = Boolean(params.safeReapply)
  const targets = Array.isArray(params.targets) ? params.targets : []
  const resolvedTargets: string[] = []

  for (let idx = 0; idx < targets.length; idx += 1) {
    const target = targets[idx] ?? {}
    const op: HashlineOpName = target.op ?? (target.startRef && target.endRef ? "replace_range" : target.ref || target.startRef ? "replace" : "set_file")
    const label = `target[${idx + 1}] ${op}`

    switch (op) {
      case "set_file": {
        resolvedTargets.push(`${label}: set_file (no refs)`)
        break
      }

      case "replace_range": {
        if (!target.startRef || !target.endRef) {
          throw new Error(`${label} requires startRef and endRef`)
        }

        const start = resolveRef(target.startRef, snapshot, safeReapply)
        const end = resolveRef(target.endRef, snapshot, safeReapply)
        if (start.index > end.index) {
          throw new Error(`${label} startRef must be on or before endRef`)
        }

        resolvedTargets.push(`${label}: ${start.lineNumber}-${end.lineNumber}`)
        break
      }

      case "replace":
      case "delete":
      case "insert_before":
      case "insert_after": {
        const resolvedRange = resolveRefRange({
          snapshot,
          ref: target.ref,
          startRef: target.startRef,
          endRef: target.endRef,
          safeReapply,
          label,
        })

        const span =
          resolvedRange.start.lineNumber === resolvedRange.end.lineNumber
            ? `${resolvedRange.start.lineNumber}`
            : `${resolvedRange.start.lineNumber}-${resolvedRange.end.lineNumber}`
        resolvedTargets.push(`${label}: ${span}`)
        break
      }

      default: {
        throw new Error(`Unsupported check operation: ${(op as string) ?? "unknown"}`)
      }
    }
  }

  const summary = [
    `Hashline check passed for ${params.filePath}.`,
    `file_hash=${snapshot.fileHash} file_rev=${computeFileRev(snapshot.raw)} targets=${targets.length}`,
  ]

  if (params.verbose && resolvedTargets.length > 0) {
    summary.push(...resolvedTargets.map((item) => `- ${item}`))
  }

  return summary.join("\n")
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

  assertFileRevisionMatches(snapshot, params.filePath, params.fileRev)

  const oldString = params.oldString ?? ""
  const newString = params.newString ?? ""
  const oldLines = splitContentToLines(oldString)
  const newLines = splitContentToLines(newString)
  let nextRaw = snapshot.raw
  let start = 0

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

    start = snapshot.raw.indexOf(oldString)
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
    diffPreview: buildOperationDiffPreview(snapshot, [{
      op: "replace",
      spliceStart: start,
      deleteCount: oldLines.length,
      insertLines: newLines,
      order: 0,
      anchorIndex: oldLines.length > 0 ? start : undefined,
      label: oldString.length === 0 ? "set_file" : `replace(old_string)`,
    }]),
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
      "patchText must be JSON for hashline patching. Use either an array of operations or an object { filePath, operations, expectedFileHash, fileRev }.",
    )
  }

  if (Array.isArray(parsed)) {
    return {
      operations: parsed as HashlineOperation[],
    }
  }

  if (parsed && typeof parsed === "object") {
    const obj = parsed as {
      filePath?: string
      file_path?: string
      operations?: HashlineOperationInput[]
      expectedFileHash?: string
      expected_file_hash?: string
      fileRev?: string
      file_rev?: string
    }
    return {
      filePath: firstNonEmptyString(obj.filePath, obj.file_path),
      operations: obj.operations,
      expectedFileHash: firstNonEmptyString(obj.expectedFileHash, obj.expected_file_hash),
      fileRev: firstNonEmptyString(obj.fileRev, obj.file_rev),
    }
  }

  throw new Error("patch_text JSON must be an array or object")
}

export type HashlineOperationInput = {
  op: HashlineOpName
  ref?: string
  startRef?: string
  start_ref?: string
  endRef?: string
  end_ref?: string
  content?: string
  replacement?: string
}

export function mapOperationInput(input: HashlineOperationInput): HashlineOperation {
  const startRef = firstNonEmptyString(input.startRef, input.start_ref)
  const endRef = firstNonEmptyString(input.endRef, input.end_ref)

  return {
    op: input.op,
    ref: input.ref,
    startRef,
    endRef,
    content: input.content ?? input.replacement,
  }
}
