declare const _default: {
    description: string;
    args: {
        filePath: import("zod").ZodOptional<import("zod").ZodString>;
        file_path: import("zod").ZodOptional<import("zod").ZodString>;
        offset: import("zod").ZodOptional<import("zod").ZodNumber>;
        limit: import("zod").ZodOptional<import("zod").ZodNumber>;
    };
    execute(args: {
        filePath?: string;
        file_path?: string;
        offset?: number;
        limit?: number;
    }, context: import("@opencode-ai/plugin").ToolContext): Promise<string>;
};
export default _default;
