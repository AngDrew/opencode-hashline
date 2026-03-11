"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_1 = require("@opencode-ai/plugin");
const hashline_core_1 = require("./hashline-core");
exports.default = (0, plugin_1.tool)({
    description: "Hashline patch tool. Expects patch_text JSON containing hashline operations instead of textual diff matching.",
    args: {
        patch_text: plugin_1.tool.schema
            .string()
            .describe("JSON string: either array of operations or object { file_path, operations, expected_file_hash }."),
        filePath: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Optional fallback file path when patch_text omits file_path."),
        file_path: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Optional fallback file path when patch_text omits file_path."),
        expected_file_hash: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Optional fallback optimistic concurrency guard."),
        dry_run: plugin_1.tool.schema
            .boolean()
            .optional()
            .describe("Validate patch without writing file."),
    },
    async execute(args, context) {
        const parsed = (0, hashline_core_1.parsePatchText)(args.patch_text);
        const filePath = parsed.filePath ?? args.filePath ?? args.file_path;
        if (!filePath) {
            throw new Error("Missing file path. Provide file_path in args or inside patch_text object.");
        }
        const operations = parsed.operations;
        if (!operations || operations.length === 0) {
            throw new Error("No operations found in patch_text");
        }
        return (0, hashline_core_1.runHashlineOperations)({
            filePath,
            operations: operations.map(hashline_core_1.mapOperationInput),
            expectedFileHash: parsed.expectedFileHash ?? args.expected_file_hash,
            dryRun: args.dry_run,
            context,
        });
    },
});
