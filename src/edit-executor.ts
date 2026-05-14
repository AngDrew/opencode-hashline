import { access, readFile, unlink, writeFile } from "node:fs/promises"
import type { ToolContext } from "@opencode-ai/plugin"
import type { HashlineEdit } from "./edit-ops.js"
import { applyHashlineEdits, HashlineMismatchError } from "./edit-ops.js"
import { canonicalizeFileText, restoreFileText } from "./file-text.js"
import { getAdaptiveHashLength, lineHash, anchorHash, computeFileRev } from "./hash.js"

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
  const filePath = args.filePath
  if (!filePath) return "Error: filePath is required"

  const operations = toEditOps(args)
  if (operations.length === 0 && args.oldString === undefined) {
    return "Error: No operations or oldString provided"
  }

  await context.ask({
    permission: "edit",
    patterns: [filePath],
    always: ["*"],
    metadata: { filePath, tool: "edit" },
  })

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
    await writeFile(filePath, writeContent, "utf-8")

    const additions = Math.max(0, result.content.split("\n").length - envelope.content.split("\n").length)
    const deletions = Math.max(0, envelope.content.split("\n").length - result.content.split("\n").length)

    const diffLines: string[] = []
    const beforeLines = envelope.content.split("\n")
    const afterLines = result.content.split("\n")
    const maxLen = Math.max(beforeLines.length, afterLines.length)
    for (let i = 0; i < maxLen; i++) {
      if ((beforeLines[i] ?? "") !== (afterLines[i] ?? "")) {
        if (beforeLines[i] !== undefined) diffLines.push(`-${beforeLines[i]}`)
        if (afterLines[i] !== undefined) diffLines.push(`+${afterLines[i]}`)
      }
    }

    if (typeof (context as any).metadata === "function") {
      (context as any).metadata({
        title: filePath,
        metadata: {
          filePath,
          filediff: {
            file: filePath,
            before: rawOldContent,
            after: writeContent,
            additions,
            deletions,
          },
          diff: diffLines.join("\n"),
          firstChangedLine: (() => {
            for (let i = 0; i < maxLen; i++) {
              if ((beforeLines[i] ?? "") !== (afterLines[i] ?? "")) return i + 1
            }
            return undefined
          })(),
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
