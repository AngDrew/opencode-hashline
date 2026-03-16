import { tool } from "@opencode-ai/plugin"
import {
  mapOperationInput,
  parseLineRef,
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

function firstNonEmptyTrimmedString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

function firstNonEmptyString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  }
  return undefined
}

function hasAnySingleOperationValue(args: Record<string, unknown>): boolean {
  return (
    firstNonEmptyTrimmedString(args.ref) !== undefined ||
    firstNonEmptyTrimmedString(args.startRef) !== undefined ||
    firstNonEmptyTrimmedString(args.endRef) !== undefined ||
    firstNonEmptyString(args.replacement) !== undefined ||
    firstNonEmptyString(args.content) !== undefined
  )
}

export default tool({
  description:
    "Hashline-aware edit tool for edit. Use operations[] for batch edits or operation + startRef/ref for a single hashline edit.",
  args: {
    filePath: tool.schema
      .string()
      .describe("Absolute or workspace-relative file path."),

    operations: tool.schema
      .array(operationSchema)
      .optional()
      .describe(
        "Preferred mode. Each operation uses hashline refs like 22#A3F#9BC. Supported ops: replace, delete, insert_before, insert_after, replace_range, set_file. If operation/startRef/ref are also present, operations[] takes precedence."
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

    if (hasOperations) {
      // Compatibility behavior: when callers send both payload styles,
      // prefer operations[] and ignore top-level single-operation fields.
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

    const hasAnySingleFields = hasAnySingleOperationValue(args as Record<string, unknown>)
    if (!hasAnySingleFields) {
      throw new Error(
        "Single-operation payload is empty: operation was provided but no ref/startRef/replacement values were set. " +
          "Call read first, then pass startRef (or ref) and replacement/content; or use operations[]."
      )
    }

    const startRef = firstNonEmptyTrimmedString(args.startRef, args.ref)
    if (!startRef) {
      throw new Error(
        "Single-operation edit requires startRef (or ref). Received empty values. " +
          "Use hash-read output refs like 12#A3F#9BC.",
      )
    }

    try {
      parseLineRef(startRef)
    } catch {
      throw new Error(
        `Invalid startRef/ref \"${startRef}\". Expected format <line>#<hash> or <line>#<hash>#<anchor> (example: 12#A3F#9BC).`,
      )
    }

    const endRef = firstNonEmptyTrimmedString(args.endRef)
    if (endRef) {
      try {
        parseLineRef(endRef)
      } catch {
        throw new Error(
          `Invalid endRef \"${endRef}\". Expected format <line>#<hash> or <line>#<hash>#<anchor> (example: 14#B1C#4DE).`,
        )
      }
    }

    const content = firstNonEmptyString(args.replacement, args.content)
    if ((args.operation === "replace" || args.operation === "insert_before" || args.operation === "insert_after") && !content) {
      throw new Error(
        `Operation \"${args.operation}\" requires replacement/content. Received empty value.`,
      )
    }

    const singleOperation: HashlineOperationInput = {
      op: args.operation,
      startRef,
      endRef,
      content,
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
