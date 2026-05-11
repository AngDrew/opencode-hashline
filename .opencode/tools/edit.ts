import { tool } from "@opencode-ai/plugin"
import {
  runHashlineOperationsDetailed,
  mapOperationInput,
  type HashlineOperationInput,
  type HashlineOpName,
} from "../lib/hashline-core.js"
import { resolveHashlineConfig, stripHashlinePrefixes } from "../plugins/hashline-shared.js"

const EDIT_DESCRIPTION = `Edit files using hash-anchored refs from read output.

WORKFLOW:
1. Read target file to get LINE#HASH#ANCHOR refs and REV token.
2. Copy refs exactly as shown. NEVER guess or fabricate refs.
3. Submit one edit call per file with all related operations.
4. Re-read after each successful edit before editing the same file again.

RULES:
- All operations in one call reference the ORIGINAL file state (pre-edit). The system applies them bottom-up automatically -- do NOT adjust refs for prior operations.
- replace removes the line at ref and inserts content in its place. Lines before and after ref are UNTOUCHED.
- replace_range removes lines startRef..endRef (inclusive) and inserts content. Content must contain ONLY what belongs inside the consumed range.
- Batch related changes as multiple operations in one call, not one large replace.
- content must be plain text only (no LINE#HASH refs, no diff markers).

OPERATIONS:
  LINE#HASH#ANCHOR format: "{line}#{hash}#{anchor}" copied from read output (e.g. "12#A3F#9BC").

  replace    + ref           -> replace single line at ref
  replace_range + startRef/endRef -> replace range inclusive
  delete     + ref           -> delete single line
  insert_before + ref        -> insert content before ref
  insert_after  + ref        -> insert content after ref

EXAMPLES (given read output with refs 10#B33#19A, 11#F73#8C6, 12#A18#EA7):
  Single replace:  { op: "replace", ref: "11#F73#8C6", content: "  new line content" }
  Range replace:   { op: "replace_range", startRef: "11#F73#8C6", endRef: "12#A18#EA7", content: "  single replacement" }
  Delete line:     { op: "delete", ref: "12#A18#EA7" }
  Insert after:    { op: "insert_after", ref: "10#B33#19A", content: "  inserted line" }

RECOVERY: If a hash mismatch error occurs, re-read the file to get fresh refs.`

export default tool({
  description: EDIT_DESCRIPTION,
  args: {
    filePath: tool.schema.string().describe("Absolute path to the file to edit"),
    fileRev: tool.schema
      .string()
      .optional()
      .describe("REV token from read output (8-char hex, e.g. A2DF5291)"),
    operations: tool.schema
      .array(
        tool.schema.object({
          op: tool.schema
            .enum(["replace", "delete", "insert_before", "insert_after", "replace_range"])
            .describe("Operation type"),
          ref: tool.schema
            .string()
            .optional()
            .describe("Single-line ref from read output (e.g. 12#A3F#9BC)"),
          startRef: tool.schema
            .string()
            .optional()
            .describe("Start ref for replace_range"),
          endRef: tool.schema
            .string()
            .optional()
            .describe("End ref for replace_range"),
          content: tool.schema
            .string()
            .optional()
            .describe("Replacement or inserted text. Omit for delete."),
        }),
      )
      .describe("Array of edit operations to apply"),
  },
  execute: async (args, context) => {
    const projectDirectory = context.directory
    const config = resolveHashlineConfig(projectDirectory)

    if (!args.operations || args.operations.length === 0) {
      return "Error: operations must be a non-empty array"
    }

    // Strip any hashline prefixes the LLM may have accidentally included in content
    const sanitizedOps: HashlineOperationInput[] = args.operations.map((op) => ({
      op: op.op as HashlineOpName,
      ref: op.ref,
      startRef: op.startRef,
      endRef: op.endRef,
      content: op.content ? stripHashlinePrefixes(op.content, config.prefix) : op.content,
    }))

    try {
      const result = await runHashlineOperationsDetailed({
        filePath: args.filePath,
        operations: sanitizedOps.map(mapOperationInput),
        fileRev: args.fileRev,
        safeReapply: config.safeReapply,
        dryRun: false,
        context: {
          directory: projectDirectory,
        },
      })

      const diff = result.metadata.filediff
      const additions = diff.additions
      const deletions = diff.deletions

      if (diff.before === diff.after) {
        return "Error: No changes made. The edits produced identical content. Re-read the file and provide content that differs from the current lines."
      }

      return `Updated ${args.filePath} (+${additions} -${deletions})`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `Error: ${message}\nTip: re-read the file to get fresh refs and fileRev.`
    }
  },
})
