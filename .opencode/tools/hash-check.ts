import { tool } from "@opencode-ai/plugin"
import { runHashlineCheck, type HashlineOpName } from "./hashline-core"

const targetSchema = tool.schema.object({
  op: tool.schema
    .enum(["replace", "delete", "insert_before", "insert_after", "replace_range", "set_file"])
    .optional(),
  ref: tool.schema.string().optional(),
  startRef: tool.schema.string().optional(),
  endRef: tool.schema.string().optional(),
})

export default tool({
  description:
    "Hashline preflight checker for low-token validation before edit/patch/write. Verifies guards and refs without writing.",
  args: {
    filePath: tool.schema
      .string()
      .describe("Absolute or workspace-relative file path."),

    targets: tool.schema
      .array(targetSchema)
      .optional()
      .describe(
        "Optional reference checks. Each target can set op + ref/startRef/endRef. If omitted, only file hash/revision guards are checked."
      ),

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
      .describe("If true, allows ref relocation by hash when line numbers drift and match is unique."),

    verbose: tool.schema
      .boolean()
      .optional()
      .describe("Include resolved line spans for each checked target."),
  },

  async execute(args, context) {
    return runHashlineCheck({
      filePath: args.filePath,
      targets: (args.targets as Array<{ op?: HashlineOpName; ref?: string; startRef?: string; endRef?: string }> | undefined)?.map(
        (item) => ({
          op: item.op,
          ref: item.ref,
          startRef: item.startRef,
          endRef: item.endRef,
        })
      ),
      expectedFileHash: args.expectedFileHash,
      fileRev: args.fileRev,
      safeReapply: args.safeReapply,
      verbose: args.verbose,
      context,
    })
  },
})