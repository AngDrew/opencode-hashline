import { tool } from "@opencode-ai/plugin"
import {
  mapOperationInput,
  runHashlineOperations,
  type HashlineOperationInput,
} from "./hashline-core"

const operationSchema = tool.schema.object({
  op: tool.schema.enum([
    "replace",
    "delete",
    "insert_before",
    "insert_after",
    "replace_range",
    "set_file",
  ]),
  ref: tool.schema.string().optional(),
  start_ref: tool.schema.string().optional(),
  end_ref: tool.schema.string().optional(),
  content: tool.schema.string().optional(),
})

const singleOperationSchema = tool.schema.enum(["replace", "delete", "insert_before", "insert_after"])

export default tool({
  description:
    "Hashline-aware edit tool. Use operations[] for batch edits or operation + start_ref/ref for a single hashline edit.",
  args: {
    filePath: tool.schema
      .string()
      .optional()
      .describe("Absolute or workspace-relative file path."),
    file_path: tool.schema
      .string()
      .optional()
      .describe("Absolute or workspace-relative file path."),

    operations: tool.schema
      .array(operationSchema)
      .optional()
      .describe(
        "Preferred mode. Each operation uses hashline refs like 22#A3F#9BC. Supported ops: replace, delete, insert_before, insert_after, replace_range, set_file."
      ),

    operation: singleOperationSchema
      .optional()
      .describe("Single-operation mode. Supports replace, delete, insert_before, insert_after."),
    ref: tool.schema
      .string()
      .optional()
      .describe("Single-operation mode: target ref (alias of start_ref)."),
    start_ref: tool.schema
      .string()
      .optional()
      .describe("Single-operation mode: start reference (required if ref not provided)."),
    end_ref: tool.schema
      .string()
      .optional()
      .describe("Single-operation mode: optional end reference for range targeting."),
    replacement: tool.schema
      .string()
      .optional()
      .describe("Single-operation mode: replacement/inserted content."),
    content: tool.schema
      .string()
      .optional()
      .describe("Single-operation mode alias for replacement."),

    expected_file_hash: tool.schema
      .string()
      .optional()
      .describe("Optional optimistic concurrency guard from read header file_hash."),
    file_rev: tool.schema
      .string()
      .optional()
      .describe("Optional file revision guard from read output '#HL REV:<hash>'."),

    safe_reapply: tool.schema
      .boolean()
      .optional()
      .describe("If true, attempts to relocate refs by hash when line numbers drift and match is unique."),

    dry_run: tool.schema
      .boolean()
      .optional()
      .describe("Validate and compute result without writing file."),
  },

  async execute(args, context) {
    const filePath = args.filePath ?? args.file_path
    if (!filePath) {
      throw new Error("Missing file path. Provide filePath (preferred) or file_path.")
    }

    const hasOperations = Array.isArray(args.operations) && args.operations.length > 0
    if (hasOperations && args.operation) {
      throw new Error("Provide either operations[] or single-operation fields, not both.")
    }

    if (hasOperations) {
      return runHashlineOperations({
        filePath,
        operations: (args.operations as HashlineOperationInput[]).map(mapOperationInput),
        expectedFileHash: args.expected_file_hash,
        fileRev: args.file_rev,
        safeReapply: args.safe_reapply,
        dryRun: args.dry_run,
        context,
      })
    }

    if (!args.operation) {
      throw new Error("No edit operation provided. Use operations[] or provide operation + start_ref/ref.")
    }

    const startRef = args.start_ref ?? args.ref
    if (!startRef) {
      throw new Error("Single-operation edit requires start_ref (or ref).")
    }

    const singleOperation: HashlineOperationInput = {
      op: args.operation,
      start_ref: startRef,
      end_ref: args.end_ref,
      content: args.replacement ?? args.content,
    }

    return runHashlineOperations({
      filePath,
      operations: [mapOperationInput(singleOperation)],
      expectedFileHash: args.expected_file_hash,
      fileRev: args.file_rev,
      safeReapply: args.safe_reapply,
      dryRun: args.dry_run,
      context,
    })
  },
})
