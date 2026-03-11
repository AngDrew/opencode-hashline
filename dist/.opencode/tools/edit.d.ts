declare const _default: {
    description: string;
    args: {
        filePath: import("zod").ZodOptional<import("zod").ZodString>;
        file_path: import("zod").ZodOptional<import("zod").ZodString>;
        operations: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
            op: import("zod").ZodEnum<{
                replace: "replace";
                delete: "delete";
                insert_before: "insert_before";
                insert_after: "insert_after";
                replace_range: "replace_range";
                set_file: "set_file";
            }>;
            ref: import("zod").ZodOptional<import("zod").ZodString>;
            start_ref: import("zod").ZodOptional<import("zod").ZodString>;
            end_ref: import("zod").ZodOptional<import("zod").ZodString>;
            content: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>>>;
        expected_file_hash: import("zod").ZodOptional<import("zod").ZodString>;
        dry_run: import("zod").ZodOptional<import("zod").ZodBoolean>;
        old_string: import("zod").ZodOptional<import("zod").ZodString>;
        new_string: import("zod").ZodOptional<import("zod").ZodString>;
    };
    execute(args: {
        filePath?: string;
        file_path?: string;
        operations?: {
            op: "replace" | "delete" | "insert_before" | "insert_after" | "replace_range" | "set_file";
            ref?: string;
            start_ref?: string;
            end_ref?: string;
            content?: string;
        }[];
        expected_file_hash?: string;
        dry_run?: boolean;
        old_string?: string;
        new_string?: string;
    }, context: import("@opencode-ai/plugin").ToolContext): Promise<string>;
};
export default _default;
