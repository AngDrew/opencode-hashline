import { tool } from "@opencode-ai/plugin"
import {
  mapOperationInput,
  parsePatchText,
  runHashlineOperations,
  type HashlineOperationInput,
} from "./hashline-core"

export default tool({
  description:
    "Hashline patch tool. Expects patch_text JSON containing hashline operations instead of textual diff matching.",
  args: {
    patch_text: tool.schema
      .string()
      .describe(
        "JSON string: either array of operations or object { file_path, operations, expected_file_hash }.",
      ),
    filePath: tool.schema
      .string()
      .optional()
      .describe("Optional fallback file path when patch_text omits file_path."),
    file_path: tool.schema
      .string()
      .optional()
      .describe("Optional fallback file path when patch_text omits file_path."),
    expected_file_hash: tool.schema
      .string()
      .optional()
      .describe("Optional fallback optimistic concurrency guard."),
    dry_run: tool.schema
      .boolean()
      .optional()
      .describe("Validate patch without writing file."),
  },
  async execute(args, context) {
    const parsed = parsePatchText(args.patch_text)
    const filePath = parsed.filePath ?? args.filePath ?? args.file_path

    if (!filePath) {
      throw new Error("Missing file path. Provide file_path in args or inside patch_text object.")
    }

    const operations = parsed.operations
    if (!operations || operations.length === 0) {
      throw new Error("No operations found in patch_text")
    }

    return runHashlineOperations({
      filePath,
      operations: (operations as HashlineOperationInput[]).map(mapOperationInput),
      expectedFileHash: parsed.expectedFileHash ?? args.expected_file_hash,
      dryRun: args.dry_run,
      context,
    })
  },
})
