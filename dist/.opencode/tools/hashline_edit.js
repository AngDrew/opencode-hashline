import { tool } from "@opencode-ai/plugin";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { hashlineLineHash, resolveFilePath } from "./hashline-core";
import { getByteLength, resolveHashlineConfig, shouldExclude } from "../plugins/hashline-shared";
class HashlineEditError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "HashlineEditError";
    }
    toDiagnostic() {
        const lines = [`[${this.code}] ${this.message}`];
        if (this.details?.lineNumber !== undefined) {
            lines.push(`Line: ${this.details.lineNumber}`);
        }
        if (this.details?.expected && this.details?.actual) {
            lines.push(`Expected hash: ${this.details.expected}`);
            lines.push(`Actual hash: ${this.details.actual}`);
        }
        if (this.details?.candidates && this.details.candidates.length > 0) {
            lines.push(`Candidates (${this.details.candidates.length}):`);
            for (const candidate of this.details.candidates) {
                const preview = candidate.content.length > 80 ? `${candidate.content.slice(0, 80)}…` : candidate.content;
                lines.push(`- ${candidate.lineNumber}: ${preview}`);
            }
        }
        return lines.join("\n");
    }
}
function parseFile(raw) {
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const normalized = raw.replace(/\r\n/g, "\n");
    const endsWithNewline = normalized.endsWith("\n");
    if (normalized.length === 0) {
        return {
            lines: [],
            eol,
            endsWithNewline,
        };
    }
    const lines = normalized.split("\n");
    if (endsWithNewline) {
        lines.pop();
    }
    return {
        lines,
        eol,
        endsWithNewline,
    };
}
function stringifyFile(parsed) {
    if (parsed.lines.length === 0) {
        return "";
    }
    const body = parsed.lines.join(parsed.eol);
    return parsed.endsWithNewline ? `${body}${parsed.eol}` : body;
}
function splitReplacement(content) {
    const normalized = content.replace(/\r\n/g, "\n");
    const endsWithNewline = normalized.endsWith("\n");
    const parts = normalized.split("\n");
    if (endsWithNewline) {
        parts.pop();
    }
    return parts;
}
function parseRef(rawRef) {
    const text = rawRef.trim().replace(/^#HL\s+/i, "");
    const beforePipe = text.split("|")[0].trim();
    const match = beforePipe.match(/^(\d+)\s*[#: ]\s*([A-Za-z0-9]+)$/);
    if (!match) {
        throw new HashlineEditError("INVALID_REF", `Invalid hash reference: "${rawRef}"`);
    }
    const lineNumber = Number.parseInt(match[1], 10);
    if (!Number.isFinite(lineNumber) || lineNumber < 1) {
        throw new HashlineEditError("INVALID_REF", `Invalid line number in hash reference: "${rawRef}"`);
    }
    return {
        lineNumber,
        hash: match[2].toUpperCase(),
    };
}
function findCandidates(expectedHash, lines) {
    const candidates = [];
    for (let idx = 0; idx < lines.length; idx += 1) {
        if (hashlineLineHash(lines[idx]) === expectedHash) {
            candidates.push({
                lineNumber: idx + 1,
                content: lines[idx],
            });
        }
    }
    return candidates;
}
function resolveLineRef(ref, lines, safeReapply) {
    const parsed = parseRef(ref);
    if (parsed.lineNumber > lines.length) {
        throw new HashlineEditError("TARGET_OUT_OF_RANGE", `Reference points to line ${parsed.lineNumber}, but file has ${lines.length} lines`, { lineNumber: parsed.lineNumber });
    }
    const index = parsed.lineNumber - 1;
    const actualHash = hashlineLineHash(lines[index]);
    if (actualHash === parsed.hash) {
        return {
            index,
            lineNumber: parsed.lineNumber,
        };
    }
    if (!safeReapply) {
        throw new HashlineEditError("HASH_MISMATCH", `Hash mismatch at line ${parsed.lineNumber}`, {
            expected: parsed.hash,
            actual: actualHash,
            lineNumber: parsed.lineNumber,
        });
    }
    const candidates = findCandidates(parsed.hash, lines);
    if (candidates.length === 1) {
        return {
            index: candidates[0].lineNumber - 1,
            lineNumber: candidates[0].lineNumber,
        };
    }
    if (candidates.length > 1) {
        throw new HashlineEditError("AMBIGUOUS_REAPPLY", `Hash mismatch at line ${parsed.lineNumber}; found multiple relocation candidates`, {
            expected: parsed.hash,
            actual: actualHash,
            lineNumber: parsed.lineNumber,
            candidates,
        });
    }
    throw new HashlineEditError("HASH_MISMATCH", `Hash mismatch at line ${parsed.lineNumber}; no relocation candidates found`, {
        expected: parsed.hash,
        actual: actualHash,
        lineNumber: parsed.lineNumber,
    });
}
function computeFileRev(raw) {
    const normalized = raw.replace(/\r\n/g, "\n");
    return createHash("sha1").update(normalized, "utf8").digest("hex").slice(0, 8).toUpperCase();
}
function requireReplacement(operation, replacement) {
    if (replacement !== undefined) {
        return replacement;
    }
    if (operation === "replace" || operation === "insert_before" || operation === "insert_after") {
        throw new HashlineEditError("MISSING_REPLACEMENT", `Operation "${operation}" requires replacement content`);
    }
    return "";
}
export default tool({
    description: "Edit files using hashline references. Resolves refs like 5:a3f or '#HL 5:a3f|...' and applies replace/delete/insert without old_string matching.",
    args: {
        path: tool.schema.string().describe("Absolute or workspace-relative file path."),
        operation: tool.schema
            .enum(["replace", "delete", "insert_before", "insert_after"])
            .describe("Single hashline edit operation."),
        startRef: tool.schema
            .string()
            .describe('Start hash reference, e.g. "5#A3F1" or "#HL 5#A3F1|const x = 1".'),
        endRef: tool.schema
            .string()
            .optional()
            .describe("Optional end hash reference for range edits."),
        replacement: tool.schema
            .string()
            .optional()
            .describe("Replacement/inserted content. Required for replace/insert operations."),
        fileRev: tool.schema
            .string()
            .optional()
            .describe("Optional file revision from read output (#HL REV:<hash>)."),
        safeReapply: tool.schema
            .boolean()
            .optional()
            .describe("If true, tries relocating moved lines by hash when unique."),
        dry_run: tool.schema
            .boolean()
            .optional()
            .describe("Validate edit without writing file."),
    },
    async execute(args, context) {
        const config = resolveHashlineConfig(context.directory);
        const absolutePath = resolveFilePath(args.path, context);
        if (shouldExclude(absolutePath, config.exclude)) {
            throw new Error(`Path is excluded by hashline config: ${args.path}`);
        }
        const raw = await fs.readFile(absolutePath, "utf8");
        if (config.maxFileSize > 0 && getByteLength(raw) > config.maxFileSize) {
            throw new Error(`File exceeds maxFileSize (${config.maxFileSize} bytes): ${args.path}`);
        }
        if (args.fileRev) {
            const actualRev = computeFileRev(raw);
            const expectedRev = args.fileRev.toUpperCase();
            if (actualRev !== expectedRev) {
                throw new HashlineEditError("FILE_REV_MISMATCH", `File revision mismatch for ${args.path}`, {
                    expected: expectedRev,
                    actual: actualRev,
                });
            }
        }
        let startLine = 0;
        let endLine = 0;
        let next = raw;
        try {
            const safeReapply = args.safeReapply ?? config.safeReapply;
            const parsed = parseFile(raw);
            let start = resolveLineRef(args.startRef, parsed.lines, safeReapply);
            let end = args.endRef ? resolveLineRef(args.endRef, parsed.lines, safeReapply) : start;
            if (start.index > end.index) {
                const first = start;
                start = end;
                end = first;
            }
            const replacement = requireReplacement(args.operation, args.replacement);
            const replacementLines = splitReplacement(replacement);
            switch (args.operation) {
                case "replace": {
                    parsed.lines.splice(start.index, end.index - start.index + 1, ...replacementLines);
                    break;
                }
                case "delete": {
                    parsed.lines.splice(start.index, end.index - start.index + 1);
                    break;
                }
                case "insert_before": {
                    parsed.lines.splice(start.index, 0, ...replacementLines);
                    break;
                }
                case "insert_after": {
                    parsed.lines.splice(end.index + 1, 0, ...replacementLines);
                    break;
                }
                default: {
                    throw new HashlineEditError("INVALID_REF", `Unsupported operation: ${String(args.operation)}`);
                }
            }
            startLine = start.lineNumber;
            endLine = end.lineNumber;
            next = stringifyFile(parsed);
        }
        catch (error) {
            if (error instanceof HashlineEditError) {
                throw new Error(error.toDiagnostic());
            }
            throw error;
        }
        if (!args.dry_run) {
            await fs.mkdir(path.dirname(absolutePath), { recursive: true });
            await fs.writeFile(absolutePath, next, "utf8");
        }
        return [
            `Hashline edit ${args.dry_run ? "(dry run) " : ""}completed for ${args.path}.`,
            `Resolved range: ${startLine}-${endLine}.`,
            "Re-read the file before issuing additional hashline refs.",
        ].join("\n");
    },
});
