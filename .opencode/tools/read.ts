import { tool } from "@opencode-ai/plugin"
import { runHashlineRead } from "./hashline-core"

export default tool({
  description:
    "Hashline file reader. Returns line-stable refs in format <line>#<hash>#<anchor>|<content> to support precise edits.",
  args: {
    filePath: tool.schema
      .string()
      .describe("Absolute or workspace-relative file path to read."),
    offset: tool.schema
      .number()
      .int()
      .positive()
      .optional()
      .describe("1-based starting line number. Defaults to 1."),
    limit: tool.schema
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of lines to return. Defaults to 2000."),
  },
  async execute(args, context) {
    return runHashlineRead({
      filePath: args.filePath,
      offset: args.offset,
      limit: args.limit,
      context,
    })
  },
})
