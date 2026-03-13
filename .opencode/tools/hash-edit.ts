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
  startRef: tool.schema.string().optional(),
  endRef: tool.schema.string().optional(),
  content: tool.schema.string().optional(),
})

const singleOperationSchema = tool.schema.enum(["replace", "delete", "insert_before", "insert_after"])

export default tool({
  description:
    "Hashline-aware edit tool for hash-edit. Use operations[] for batch edits or operation + startRef/ref for a single hashline edit.",
  args: {
    filePath: tool.schema
      .string()
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
      .describe("Single-operation mode: target ref (alias of startRef)."),
    startRef: tool.schema
      .string()
      .optional()
      .describe("Single-operation mode: start reference (required if ref not provided)."),
    endRef: tool.schema
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

    expectedFileHash: tool.schema
      .string()
      .optional()
      .describe("Optional optimistic concurrency guard from read header file_hash."),
    fileRev: tool.schema
      .string()
      .optional()
      .describe("Optional file revision guard from read output '#HL REV:<hash>'."),

    safeReapply: tool.schema
      .boolean()
      .optional()
      .describe("If true, attempts to relocate refs by hash when line numbers drift and match is unique."),

    dryRun: tool.schema
      .boolean()
      .optional()
      .describe("Validate and compute result without writing file."),
  },

  async execute(args, context) {
    const filePath = args.filePath

    const hasOperations = Array.isArray(args.operations) && args.operations.length > 0
    if (hasOperations && args.operation) {
      throw new Error("Provide either operations[] or single-operation fields, not both.")
    }

    if (hasOperations) {
      return runHashlineOperations({
        filePath,
        operations: (args.operations as HashlineOperationInput[]).map(mapOperationInput),
        expectedFileHash: args.expectedFileHash,
        fileRev: args.fileRev,
        safeReapply: args.safeReapply,
        dryRun: args.dryRun,
        context,
      })
    }

    if (!args.operation) {
      throw new Error("No edit operation provided. Use operations[] or provide operation + startRef/ref.")
    }

    const startRef = args.startRef ?? args.ref
    if (!startRef) {
      throw new Error("Single-operation edit requires startRef (or ref).")
    }

    const singleOperation: HashlineOperationInput = {
      op: args.operation,
      startRef,
      endRef: args.endRef,
      content: args.replacement ?? args.content,
    }

    return runHashlineOperations({
      filePath,
      operations: [mapOperationInput(singleOperation)],
      expectedFileHash: args.expectedFileHash,
      fileRev: args.fileRev,
      safeReapply: args.safeReapply,
      dryRun: args.dryRun,
      context,
    })
  },
})
