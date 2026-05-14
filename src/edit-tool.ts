import { tool } from "@opencode-ai/plugin/tool"
import type { ToolContext } from "@opencode-ai/plugin"
import { executeEditTool } from "./edit-executor.js"

const HASHLINE_EDIT_DESCRIPTION = `Edit files using LINE#ID format for precise, safe modifications.

WORKFLOW:
1. Read target file/range and copy exact LINE#ID tags.
2. Pick the smallest operation per logical mutation site.
3. Submit one edit call per file with all related operations.
4. If same file needs another call, re-read first.
5. Use anchors as "LINE#ID" only (never include trailing "|content").

LINE#ID FORMAT:
  Each line reference uses {line_number}#{hash_id}#{anchor_id} where:
  - {hash_id}: hex hash (3-4 chars) of line content
  - {anchor_id}: hex hash (3-4 chars) of surrounding context

Copy refs exactly as shown in hashline read/edit tools.

OPERATIONS:
  replace with pos only -> replace one line at pos
  replace with pos+end -> replace range pos..end
  append with pos -> insert after anchor
  prepend with pos -> insert before anchor
  append/prepend without pos -> EOF/BOF insertion

RULES:
  1. Minimize scope: one logical mutation per operation.
  2. Anchor to structural lines (function/class/brace), NEVER blank lines.
  3. No no-ops: content must differ from current lines.
  4. For swaps/moves: use one range operation over multiple single-line ops.
  5. Re-read after successful edit before calling another on the same file.`

const argsSchema = {
  filePath: tool.schema
    .string()
    .describe("Absolute path to the file to edit"),

  operations: tool.schema
    .array(
      tool.schema.object({
        op: tool.schema
          .string()
          .optional()
          .describe("Operation: replace, append, or prepend"),
        ref: tool.schema
          .string()
          .optional()
          .describe("Primary anchor LINE#HASH#ANCHOR"),
        startRef: tool.schema
          .string()
          .optional()
          .describe("Primary anchor LINE#HASH#ANCHOR"),
        endRef: tool.schema
          .string()
          .optional()
          .describe("Range end anchor LINE#HASH#ANCHOR"),
        content: tool.schema
          .string()
          .optional()
          .describe("Replacement content"),
        replacement: tool.schema
          .string()
          .optional()
          .describe("Replacement content alias"),
        lines: tool.schema
          .union([
            tool.schema.array(tool.schema.string()),
            tool.schema.string(),
            tool.schema.null(),
          ])
          .optional()
          .describe("Replacement lines. null deletes with replace"),
      }),
    )
    .optional()
    .describe("Batch edit operations"),

  oldString: tool.schema
    .string()
    .optional()
    .describe("Exact text to replace (legacy mode)"),

  newString: tool.schema
    .string()
    .optional()
    .describe("Replacement text (legacy mode)"),

  expectedFileHash: tool.schema
    .string()
    .optional()
    .describe("Expected file hash for stale edit protection"),

  fileRev: tool.schema
    .string()
    .optional()
    .describe("Expected file revision (8-char hex) from read output"),

  safeReapply: tool.schema
    .boolean()
    .optional()
    .describe("Allow ref relocation when hashes still match"),
} as const

export function createEditTool() {
  return tool({
    description: HASHLINE_EDIT_DESCRIPTION,
    args: argsSchema as any,
    execute: async (args: Record<string, unknown>, context: ToolContext): Promise<string> => {
      return executeEditTool(args as any, context)
    },
  })
}
