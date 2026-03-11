import { tool } from "@opencode-ai/plugin"
import { runHashlineOperations } from "./hashline-core"

export default tool({
  description: "Hashline-compatible full file writer implemented through set_file operation.",
  args: {
    filePath: tool.schema
      .string()
      .describe("Absolute or workspace-relative file path."),
    content: tool.schema
      .string()
      .describe("Full file content to write."),
    expectedFileHash: tool.schema
      .string()
      .optional()
      .describe("Optional optimistic concurrency guard from read header file_hash."),
    fileRev: tool.schema
      .string()
      .optional()
      .describe("Optional file revision guard from read output '#HL REV:<hash>'."),
    dryRun: tool.schema
      .boolean()
      .optional()
      .describe("Validate and compute result without writing file."),
  },
  async execute(args, context) {
    return runHashlineOperations({
      filePath: args.filePath,
      operations: [
        {
          op: "set_file",
          content: args.content,
        },
      ],
      expectedFileHash: args.expectedFileHash,
      fileRev: args.fileRev,
      dryRun: args.dryRun,
      context,
    })
  },
})
