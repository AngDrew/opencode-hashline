declare const _default: {
    description: string;
    args: {
        patch_text: import("zod").ZodString;
        filePath: import("zod").ZodOptional<import("zod").ZodString>;
        file_path: import("zod").ZodOptional<import("zod").ZodString>;
        expected_file_hash: import("zod").ZodOptional<import("zod").ZodString>;
        dry_run: import("zod").ZodOptional<import("zod").ZodBoolean>;
    };
    execute(args: {
        patch_text: string;
        filePath?: string;
        file_path?: string;
        expected_file_hash?: string;
        dry_run?: boolean;
    }, context: import("@opencode-ai/plugin").ToolContext): Promise<string>;
};
export default _default;
