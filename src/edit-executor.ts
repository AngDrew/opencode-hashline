import { access, readFile, unlink, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { createTwoFilesPatch, diffLines } from "diff"
import { Effect } from "effect"
import type { ToolContext } from "@opencode-ai/plugin"

async function runMaybeEffect<T>(value: T | Promise<T> | any): Promise<T> {
  if (value == null) return value as T
  if (typeof (value as any).then === "function") return await (value as Promise<T>)
  const isEffectV4 =
    typeof value === "object" && "~effect/Effect/args" in (value as any)
  const isEffectV3 = (value as any)._id === "Effect"
  if (isEffectV4 || isEffectV3) {
    return await Effect.runPromise(value as any)
  }
  return value as T
}
import type { HashlineEdit } from "./edit-ops.js"
import { applyHashlineEdits, HashlineMismatchError } from "./edit-ops.js"
import { canonicalizeFileText, restoreFileText } from "./file-text.js"
import { getAdaptiveHashLength, lineHash, anchorHash, computeFileRev } from "./hash.js"

function trimDiff(diff: string): string {
  const lines = diff.split("\n")
  const contentLines = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )
  if (contentLines.length === 0) return diff
  let min = Infinity
  for (const line of contentLines) {
    const content = line.slice(1)
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/)
      if (match) min = Math.min(min, match[1].length)
    }
  }
  if (min === Infinity || min === 0) return diff
  return lines
    .map((line) => {
      if (
        (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
        !line.startsWith("---") &&
        !line.startsWith("+++")
      ) {
        return line[0] + line.slice(1).slice(min)
      }
      return line
    })
    .join("\n")
}

export interface EditToolArgs {
  filePath: string
  operations?: Array<{
    op?: string
    ref?: string
    startRef?: string
    endRef?: string
    content?: string
    replacement?: string
    lines?: string[] | string | null
  }>
  oldString?: string
  newString?: string
  expectedFileHash?: string
  fileRev?: string
  safeReapply?: boolean
}

function toEditOps(args: EditToolArgs): HashlineEdit[] {
  if (Array.isArray(args.operations) && args.operations.length > 0) {
    return args.operations.map((op) => {
      const ref = op.startRef ?? op.ref
      const lines = op.content ?? op.replacement ?? op.lines ?? null
      if (!ref && op.op === "replace" && typeof lines === "string") {
        return { op: "replace" as const, lines }
      }
      return {
        op: (op.op as HashlineEdit["op"]) ?? "replace",
        pos: ref,
        end: op.endRef,
        lines,
      }
    })
  }
  if (args.oldString !== undefined && args.newString !== undefined) {
    return [{ op: "replace" as const, lines: args.newString }]
  }
  return []
}

export async function executeEditTool(
  args: EditToolArgs,
  context: ToolContext,
): Promise<string> {
  if (!args.filePath) return "Error: filePath is required"
  const filePath = path.isAbsolute(args.filePath)
    ? args.filePath
    : path.join(context.directory, args.filePath)
  const worktree = context.worktree ?? context.directory
  const relPath = path.relative(worktree, filePath) || filePath

  const operations = toEditOps(args)
  if (operations.length === 0 && args.oldString === undefined) {
    return "Error: No operations or oldString provided"
  }

  try {
    const exists = await access(filePath).then(() => true).catch(() => false)
    if (!exists) {
      if (operations.length === 1 && operations[0].op === "append" && !operations[0].pos) {
        await writeFile(filePath, "", "utf8")
      } else {
        return `Error: File not found: ${filePath}`
      }
    }

    const rawOldContent = exists ? await readFile(filePath, "utf-8") : ""
    const envelope = canonicalizeFileText(rawOldContent)

    if (args.expectedFileHash) {
      const actualHash = computeFileRev(rawOldContent)
      if (actualHash !== args.expectedFileHash.toUpperCase()) {
        return `Error: File hash mismatch. Expected ${args.expectedFileHash.toUpperCase()}, actual ${actualHash}. Read the file again.`
      }
    }
    if (args.fileRev) {
      const actualRev = computeFileRev(rawOldContent)
      if (actualRev !== args.fileRev.toUpperCase()) {
        return `Error: File revision mismatch. Expected ${args.fileRev.toUpperCase()}, actual ${actualRev}. Read the file again.`
      }
    }

    let result: { content: string; noopEdits: number; deduplicatedEdits: number }

    if (operations.length > 0 && operations[0].pos !== undefined) {
      result = applyHashlineEdits(envelope.content, operations)
    } else if (args.oldString !== undefined) {
      const idx = envelope.content.indexOf(args.oldString)
      if (idx === -1) return "Error: old_string was not found in file"
      const newContent = envelope.content.slice(0, idx) + (args.newString ?? "") + envelope.content.slice(idx + args.oldString.length)
      result = { content: newContent, noopEdits: newContent === envelope.content ? 1 : 0, deduplicatedEdits: 0 }
    } else {
      result = applyHashlineEdits(envelope.content, operations)
    }

    if (result.noopEdits > 0 && result.content === envelope.content) {
      return `Error: No changes made to ${filePath}. The edits produced identical content.`
    }
    const writeContent = restoreFileText(result.content, envelope)

    let additions = 0
    let deletions = 0
    for (const change of diffLines(envelope.content, result.content)) {
      if (change.added) additions += change.count || 0
      if (change.removed) deletions += change.count || 0
    }

    const diffStr = trimDiff(
      createTwoFilesPatch(filePath, filePath, envelope.content, result.content),
    )

    await runMaybeEffect(
      context.ask({
        permission: "edit",
        patterns: [relPath],
        always: [relPath],
        metadata: { filepath: filePath, diff: diffStr },
      }),
    )

    await writeFile(filePath, writeContent, "utf-8")

    if (typeof (context as any).metadata === "function") {
      (context as any).metadata({
        metadata: {
          diff: diffStr,
          filediff: {
            file: filePath,
            patch: diffStr,
            additions,
            deletions,
          },
          diagnostics: {},
        },
      })
    }

    return `Updated ${filePath} (${additions > 0 ? `+${additions}` : ""}${deletions > 0 ? ` -${deletions}` : ""})`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof HashlineMismatchError) {
      return `Error: hash mismatch - ${message}\nTip: reuse LINE#ID entries from the latest read/edit output, or batch related edits in one call.`
    }
    return `Error: ${message}`
  }
}
