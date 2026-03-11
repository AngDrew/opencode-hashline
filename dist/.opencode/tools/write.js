"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_1 = require("@opencode-ai/plugin");
const hashline_core_1 = require("./hashline-core");
exports.default = (0, plugin_1.tool)({
    description: "Hashline-compatible full file writer implemented through set_file operation.",
    args: {
        filePath: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Absolute or workspace-relative file path."),
        file_path: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Absolute or workspace-relative file path."),
        content: plugin_1.tool.schema
            .string()
            .describe("Full file content to write."),
        expected_file_hash: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Optional optimistic concurrency guard from read header file_hash."),
        dry_run: plugin_1.tool.schema
            .boolean()
            .optional()
            .describe("Validate and compute result without writing file."),
    },
    async execute(args, context) {
        const filePath = args.filePath ?? args.file_path;
        if (!filePath) {
            throw new Error("Missing file path. Provide filePath (preferred) or file_path.");
        }
        return (0, hashline_core_1.runHashlineOperations)({
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
