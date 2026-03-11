import { tool } from "@opencode-ai/plugin";
import { runHashlineOperations } from "./hashline-core";
export default tool({
    description: "Hashline-compatible full file writer implemented through set_file operation.",
    args: {
        filePath: tool.schema
            .string()
            .optional()
            .describe("Absolute or workspace-relative file path."),
        file_path: tool.schema
            .string()
            .optional()
            .describe("Absolute or workspace-relative file path."),
        content: tool.schema
            .string()
            .describe("Full file content to write."),
        expected_file_hash: tool.schema
            .string()
            .optional()
            .describe("Optional optimistic concurrency guard from read header file_hash."),
        dry_run: tool.schema
            .boolean()
            .optional()
            .describe("Validate and compute result without writing file."),
    },
    async execute(args, context) {
        const filePath = args.filePath ?? args.file_path;
        if (!filePath) {
            throw new Error("Missing file path. Provide filePath (preferred) or file_path.");
        }
        return runHashlineOperations({
            filePath,
            operations: [
                {
                    op: "set_file",
                    content: args.content,
                },
            ],
            expectedFileHash: args.expected_file_hash,
            dryRun: args.dry_run,
            context,
        });
    },
});
