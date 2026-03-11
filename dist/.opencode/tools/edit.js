"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_1 = require("@opencode-ai/plugin");
const hashline_core_1 = require("./hashline-core");
const operationSchema = plugin_1.tool.schema.object({
    op: plugin_1.tool.schema.enum([
        "replace",
        "delete",
        "insert_before",
        "insert_after",
        "replace_range",
        "set_file",
    ]),
    ref: plugin_1.tool.schema.string().optional(),
    start_ref: plugin_1.tool.schema.string().optional(),
    end_ref: plugin_1.tool.schema.string().optional(),
    content: plugin_1.tool.schema.string().optional(),
});
exports.default = (0, plugin_1.tool)({
    description: "Hashline-aware edit tool. Prefer operations[] with line refs from read output. Legacy old/new string mode remains available.",
    args: {
        filePath: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Absolute or workspace-relative file path."),
        file_path: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Absolute or workspace-relative file path."),
        operations: plugin_1.tool.schema
            .array(operationSchema)
            .optional()
            .describe("Preferred mode. Each operation uses hashline refs like 22#A3F1. Supported ops: replace, delete, insert_before, insert_after, replace_range, set_file."),
        expected_file_hash: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Optional optimistic concurrency guard from read header file_hash."),
        dry_run: plugin_1.tool.schema
            .boolean()
            .optional()
            .describe("Validate and compute result without writing file."),
        old_string: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Legacy fallback mode: exact string to replace (must be unique)."),
        new_string: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Legacy fallback mode: replacement string."),
    },
    async execute(args, context) {
        const filePath = args.filePath ?? args.file_path;
        if (!filePath) {
            throw new Error("Missing file path. Provide filePath (preferred) or file_path.");
        }
        if (args.operations && args.operations.length > 0) {
            return (0, hashline_core_1.runHashlineOperations)({
                filePath,
                operations: args.operations.map(hashline_core_1.mapOperationInput),
                expectedFileHash: args.expected_file_hash,
                dryRun: args.dry_run,
                context,
            });
        }
        return (0, hashline_core_1.runLegacyEdit)({
            filePath,
            oldString: args.old_string,
            newString: args.new_string,
            expectedFileHash: args.expected_file_hash,
            dryRun: args.dry_run,
            context,
        });
    },
});
