import { tool } from "@opencode-ai/plugin";
import { mapOperationInput, runHashlineOperations, runLegacyEdit, } from "./hashline-core";
const operationSchema = tool.schema.object({
    op: tool.schema.enum([
        "replace",
        "delete",
        "insert_before",
        "insert_after",
        "replace_range",
        "set_file",
    ]),
    ref: tool.schema.string().optional(),
    start_ref: tool.schema.string().optional(),
    end_ref: tool.schema.string().optional(),
    content: tool.schema.string().optional(),
});
export default tool({
    description: "Hashline-aware edit tool. Prefer operations[] with line refs from read output. Legacy old/new string mode remains available.",
    args: {
        filePath: tool.schema
            .string()
            .optional()
            .describe("Absolute or workspace-relative file path."),
        file_path: tool.schema
            .string()
            .optional()
            .describe("Absolute or workspace-relative file path."),
        operations: tool.schema
            .array(operationSchema)
            .optional()
            .describe("Preferred mode. Each operation uses hashline refs like 22#A3F1. Supported ops: replace, delete, insert_before, insert_after, replace_range, set_file."),
        expected_file_hash: tool.schema
            .string()
            .optional()
            .describe("Optional optimistic concurrency guard from read header file_hash."),
        dry_run: tool.schema
            .boolean()
            .optional()
            .describe("Validate and compute result without writing file."),
        old_string: tool.schema
            .string()
            .optional()
            .describe("Legacy fallback mode: exact string to replace (must be unique)."),
        new_string: tool.schema
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
            return runHashlineOperations({
                filePath,
                operations: args.operations.map(mapOperationInput),
                expectedFileHash: args.expected_file_hash,
                dryRun: args.dry_run,
                context,
            });
        }
        return runLegacyEdit({
            filePath,
            oldString: args.old_string,
            newString: args.new_string,
            expectedFileHash: args.expected_file_hash,
            dryRun: args.dry_run,
            context,
        });
    },
});
