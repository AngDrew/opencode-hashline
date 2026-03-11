import { tool } from "@opencode-ai/plugin"
import { runHashlineRead } from "./hashline-core"

export default tool({
  description:
    "Hashline file reader. Returns line-stable refs in format <line>#<hash>#<anchor>|<content> to support precise edits.",
  args: {
    filePath: tool.schema
      .string()
      .optional()
      .describe("Absolute or workspace-relative file path to read."),
    file_path: tool.schema
      .string()
      .optional()
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
    const filePath = args.filePath ?? args.file_path
    if (!filePath) {
      throw new Error("Missing file path. Provide filePath (preferred) or file_path.")
    }

    return runHashlineRead({
      filePath,
      offset: args.offset,
      limit: args.limit,
      context,
    })
  },
})
