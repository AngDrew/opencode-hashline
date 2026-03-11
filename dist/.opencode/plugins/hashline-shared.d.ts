export interface HashlineRuntimeConfig {
    exclude: string[];
    maxFileSize: number;
    cacheSize: number;
    prefix: string | false;
    fileRev: boolean;
    safeReapply: boolean;
}
export declare const DEFAULT_PREFIX = "#HL ";
export declare const DEFAULT_EXCLUDE_PATTERNS: string[];
export declare const DEFAULT_HASHLINE_RUNTIME_CONFIG: HashlineRuntimeConfig;
export declare function resolveHashlineConfig(projectDir?: string): HashlineRuntimeConfig;
export declare function shouldExclude(filePath: string, patterns: string[]): boolean;
export declare function getByteLength(content: string): number;
export declare function computeFileRev(content: string): string;
interface HashlineFormatOptions {
    prefix?: string | false;
    includeFileRev?: boolean;
}
export declare function formatWithHashline(content: string, options?: HashlineFormatOptions): string;
export declare function stripHashlinePrefixes(content: string, prefix?: string | false): string;
export declare class HashlineAnnotationCache {
    private readonly maxSize;
    private readonly entries;
    constructor(maxSize?: number);
    get(key: string, source: string): string | null;
    set(key: string, source: string, annotated: string): void;
    invalidate(key: string): void;
    clear(): void;
}
export declare function extractPathFromToolArgs(args?: Record<string, unknown>): string | undefined;
export {};
