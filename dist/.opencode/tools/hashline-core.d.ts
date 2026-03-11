export type HashlineOpName = "replace" | "delete" | "insert_before" | "insert_after" | "replace_range" | "set_file";
export interface HashlineOperation {
    op: HashlineOpName;
    ref?: string;
    startRef?: string;
    endRef?: string;
    content?: string;
}
export declare function hashlineLineHash(line: string): string;
export declare function resolveFilePath(filePath: string, context?: {
    directory?: string;
}): string;
export declare function runHashlineRead(params: {
    filePath: string;
    offset?: number;
    limit?: number;
    context?: {
        directory?: string;
    };
}): Promise<string>;
export declare function runHashlineOperations(params: {
    filePath: string;
    operations: HashlineOperation[];
    expectedFileHash?: string;
    dryRun?: boolean;
    context?: {
        directory?: string;
    };
}): Promise<string>;
export declare function runLegacyEdit(params: {
    filePath: string;
    oldString?: string;
    newString?: string;
    expectedFileHash?: string;
    dryRun?: boolean;
    context?: {
        directory?: string;
    };
}): Promise<string>;
export declare function parsePatchText(patchText: string): {
    filePath?: string;
    operations?: HashlineOperation[];
    expectedFileHash?: string;
};
export type HashlineOperationInput = {
    op: HashlineOpName;
    ref?: string;
    start_ref?: string;
    end_ref?: string;
    content?: string;
};
export declare function mapOperationInput(input: HashlineOperationInput): HashlineOperation;
