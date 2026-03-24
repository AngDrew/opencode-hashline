import { tool } from "@opencode-ai/plugin"
import { resolveFilePath, resolveHashlineEdit, type HashlineOperationInput, type HashlineOpName, mapOperationInput } from "../lib/hashline-core.js"
import { resolveHashlineConfig } from "../plugins/hashline-shared.js"

export interface HashlineResolveEditArgs {
  filePath: string
  operations: HashlineOperationInput[]
  fileRev?: string
  safeReapply?: boolean
}

export const hashlineResolveEditTool = tool({
  description:
    "Resolves hashline line references to native edit format. Use after read() to convert hashline operations to oldString/newString for native edit(). Returns JSON with filePath, oldString, newString, and fileRev.",
  args: {
    filePath: tool.schema.string().describe("Path to the file to edit"),
    operations: tool.schema
      .array(
        tool.schema.object({
          op: tool.schema.enum(["replace", "delete", "insert_before", "insert_after", "replace_range"]),
          ref: tool.schema.string().optional(),
          startRef: tool.schema.string().optional(),
          endRef: tool.schema.string().optional(),
          content: tool.schema.string().optional(),
        }),
      )
      .describe("Array of hashline operations with refs"),
    fileRev: tool.schema.string().optional().describe("Optional file revision from read output (e.g., 1A2B3C4D)"),
    safeReapply: tool.schema.boolean().optional().describe("Allow relocating refs if hash matches but line number changed"),
  },
  execute: async (args, context) => {
    const projectDirectory = context.directory
    const config = resolveHashlineConfig(projectDirectory)

    const absolutePath = resolveFilePath(args.filePath)

    try {
      const result = await resolveHashlineEdit({
        filePath: args.filePath,
        operations: args.operations.map((op) => mapOperationInput({ ...op, op: op.op as HashlineOpName })),
        fileRev: args.fileRev,
        safeReapply: args.safeReapply ?? config.safeReapply,
        dryRun: true,
        context: {
          directory: projectDirectory,
        },
      })

      return JSON.stringify(
        {
          filePath: result.filePath,
          oldString: result.oldString,
          newString: result.newString,
          fileRev: result.fileRev,
          summary: result.summary,
        },
        null,
        2,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return JSON.stringify(
        {
          error: message,
          filePath: absolutePath,
          hint: "Read the file again to get fresh refs and fileRev",
        },
        null,
        2,
      )
    }
  },
})
