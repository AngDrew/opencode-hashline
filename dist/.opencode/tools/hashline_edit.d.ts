declare const _default: {
    description: string;
    args: {
        path: import("zod").ZodString;
        operation: import("zod").ZodEnum<{
            replace: "replace";
            delete: "delete";
            insert_before: "insert_before";
            insert_after: "insert_after";
        }>;
        startRef: import("zod").ZodString;
        endRef: import("zod").ZodOptional<import("zod").ZodString>;
        replacement: import("zod").ZodOptional<import("zod").ZodString>;
        fileRev: import("zod").ZodOptional<import("zod").ZodString>;
        safeReapply: import("zod").ZodOptional<import("zod").ZodBoolean>;
        dry_run: import("zod").ZodOptional<import("zod").ZodBoolean>;
    };
    execute(args: {
        path: string;
        operation: "replace" | "delete" | "insert_before" | "insert_after";
        startRef: string;
        endRef?: string;
        replacement?: string;
        fileRev?: string;
        safeReapply?: boolean;
        dry_run?: boolean;
    }, context: import("@opencode-ai/plugin").ToolContext): Promise<string>;
};
export default _default;
