import { tool } from "@opencode-ai/plugin"
import {
  mapOperationInput,
  parsePatchText,
  runHashlineOperations,
  type HashlineOperationInput,
} from "./hashline-core"

export default tool({
  description:
    "Hashline patch tool for patch. Expects patchText JSON containing hashline operations instead of textual diff matching.",
  args: {
    patchText: tool.schema
      .string()
      .describe(
        "JSON string: either array of operations or object { filePath, operations, expectedFileHash, fileRev }."
      ),
    filePath: tool.schema
      .string()
      .optional()
      .describe("Optional fallback file path when patchText omits filePath."),
    expectedFileHash: tool.schema
      .string()
      .optional()
      .describe("Optional fallback optimistic concurrency guard."),
    fileRev: tool.schema
      .string()
      .optional()
      .describe("Optional fallback file revision guard from read output '#HL REV:<hash>'."),
    dryRun: tool.schema
      .boolean()
      .optional()
      .describe("Validate patch without writing file."),
  },
  async execute(args, context) {
    const parsed = parsePatchText(args.patchText)
    const filePath = parsed.filePath ?? args.filePath

    if (!filePath) {
      throw new Error("Missing file path. Provide filePath in args or inside patchText object.")
    }

    const operations = parsed.operations
    if (!operations || operations.length === 0) {
      throw new Error("No operations found in patchText")
    }

    return runHashlineOperations({
      filePath,
      operations: (operations as HashlineOperationInput[]).map(mapOperationInput),
      expectedFileHash: parsed.expectedFileHash ?? args.expectedFileHash,
      fileRev: parsed.fileRev ?? args.fileRev,
      dryRun: args.dryRun,
      context,
    })
  },
})
