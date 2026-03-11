import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const LINE_HASH_LEN = 4;
function hashText(text, length = 10) {
    return createHash("sha1").update(text, "utf8").digest("hex").slice(0, length).toUpperCase();
}
export function hashlineLineHash(line) {
    return hashText(line, LINE_HASH_LEN);
}
function parseRaw(raw) {
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const normalized = raw.replace(/\r\n/g, "\n");
    const endsWithNewline = normalized.endsWith("\n");
    let lines = [];
    if (normalized.length > 0) {
        lines = normalized.split("\n");
        if (endsWithNewline) {
            lines.pop();
        }
    }
    return {
        raw,
        lines,
        eol,
        endsWithNewline,
        fileHash: hashText(raw),
    };
}
function stringifyLines(lines, eol, endsWithNewline) {
    if (lines.length === 0) {
        return "";
    }
    const body = lines.join(eol);
    return endsWithNewline ? `${body}${eol}` : body;
}
function splitContentToLines(content) {
    const normalized = content.replace(/\r\n/g, "\n");
    const hasTrailingNewline = normalized.endsWith("\n");
    const parts = normalized.split("\n");
    if (hasTrailingNewline && parts.length > 0) {
        parts.pop();
    }
    return parts;
}
function parseRef(ref) {
    const match = ref.trim().match(/^(\d+)\s*[#: ]\s*([A-Za-z0-9]+)$/);
    if (!match) {
        throw new Error(`Invalid line reference "${ref}". Expected format: <line>#<hash> (example: 22#A3F1)`);
    }
    const lineNumber = Number.parseInt(match[1], 10);
    if (!Number.isFinite(lineNumber) || lineNumber < 1) {
        throw new Error(`Invalid line number in reference "${ref}"`);
    }
    return {
        lineNumber,
        hash: match[2].toUpperCase(),
    };
}
function resolveRef(ref, snapshot) {
    const parsed = parseRef(ref);
    if (parsed.lineNumber > snapshot.lines.length) {
        throw new Error(`Reference ${ref} points to line ${parsed.lineNumber}, but file only has ${snapshot.lines.length} lines. Read the file again.`);
    }
    const index = parsed.lineNumber - 1;
    const actualLine = snapshot.lines[index];
    const actualHash = hashlineLineHash(actualLine);
    if (actualHash !== parsed.hash) {
        throw new Error(`Hash mismatch for line ${parsed.lineNumber}. Expected ${parsed.hash}, actual ${actualHash}. Current ref is ${parsed.lineNumber}#${actualHash}. Read the file again.`);
    }
    return {
        index,
        lineNumber: parsed.lineNumber,
    };
}
export function resolveFilePath(filePath, context) {
    const baseDirectory = typeof context?.directory === "string" && context.directory.length > 0 ? context.directory : process.cwd();
    return path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(baseDirectory, filePath);
}
async function readSnapshot(absolutePath) {
    const raw = await fs.readFile(absolutePath, "utf8");
    const parsed = parseRaw(raw);
    return {
        absolutePath,
        ...parsed,
    };
}
async function readSnapshotIfExists(absolutePath) {
    try {
        return await readSnapshot(absolutePath);
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}
function emptySnapshot(absolutePath) {
    return {
        absolutePath,
        raw: "",
        lines: [],
        eol: "\n",
        endsWithNewline: false,
        fileHash: hashText(""),
    };
}
function normalizeOperations(operations) {
    return operations.map((op) => ({
        op: op.op,
        ref: op.ref?.trim(),
        startRef: op.startRef?.trim(),
        endRef: op.endRef?.trim(),
        content: op.content,
    }));
}
function resolveChanges(snapshot, operations) {
    if (operations.length === 0) {
        throw new Error("No operations provided");
    }
    const setFileCount = operations.filter((op) => op.op === "set_file").length;
    if (setFileCount > 0 && operations.length > 1) {
        throw new Error("set_file cannot be combined with other operations");
    }
    return operations.map((op, order) => {
        switch (op.op) {
            case "replace": {
                if (!op.ref) {
                    throw new Error("replace requires ref");
                }
                if (op.content === undefined) {
                    throw new Error("replace requires content");
                }
                const resolved = resolveRef(op.ref, snapshot);
                return {
                    op: op.op,
                    spliceStart: resolved.index,
                    deleteCount: 1,
                    insertLines: splitContentToLines(op.content),
                    order,
                    anchorIndex: resolved.index,
                    label: `replace(${op.ref})`,
                };
            }
            case "delete": {
                if (!op.ref) {
                    throw new Error("delete requires ref");
                }
                const resolved = resolveRef(op.ref, snapshot);
                return {
                    op: op.op,
                    spliceStart: resolved.index,
                    deleteCount: 1,
                    insertLines: [],
                    order,
                    anchorIndex: resolved.index,
                    label: `delete(${op.ref})`,
                };
            }
            case "insert_before": {
                if (!op.ref) {
                    throw new Error("insert_before requires ref");
                }
                if (op.content === undefined) {
                    throw new Error("insert_before requires content");
                }
                const resolved = resolveRef(op.ref, snapshot);
                return {
                    op: op.op,
                    spliceStart: resolved.index,
                    deleteCount: 0,
                    insertLines: splitContentToLines(op.content),
                    order,
                    anchorIndex: resolved.index,
                    label: `insert_before(${op.ref})`,
                };
            }
            case "insert_after": {
                if (!op.ref) {
                    throw new Error("insert_after requires ref");
                }
                if (op.content === undefined) {
                    throw new Error("insert_after requires content");
                }
                const resolved = resolveRef(op.ref, snapshot);
                return {
                    op: op.op,
                    spliceStart: resolved.index + 1,
                    deleteCount: 0,
                    insertLines: splitContentToLines(op.content),
                    order,
                    anchorIndex: resolved.index,
                    label: `insert_after(${op.ref})`,
                };
            }
            case "replace_range": {
                if (!op.startRef || !op.endRef) {
                    throw new Error("replace_range requires startRef and endRef");
                }
                if (op.content === undefined) {
                    throw new Error("replace_range requires content");
                }
                const start = resolveRef(op.startRef, snapshot);
                const end = resolveRef(op.endRef, snapshot);
                if (start.index > end.index) {
                    throw new Error("replace_range startRef must be on or before endRef");
                }
                return {
                    op: op.op,
                    spliceStart: start.index,
                    deleteCount: end.index - start.index + 1,
                    insertLines: splitContentToLines(op.content),
                    order,
                    anchorIndex: start.index,
                    label: `replace_range(${op.startRef}..${op.endRef})`,
                };
            }
            case "set_file": {
                if (op.content === undefined) {
                    throw new Error("set_file requires content");
                }
                return {
                    op: op.op,
                    spliceStart: 0,
                    deleteCount: snapshot.lines.length,
                    insertLines: splitContentToLines(op.content),
                    order,
                    anchorIndex: undefined,
                    label: "set_file",
                };
            }
            default:
                throw new Error(`Unsupported operation: ${op.op ?? "unknown"}`);
        }
    });
}
function validateChangeConflicts(changes) {
    const consumed = new Map();
    for (const change of changes) {
        if (change.deleteCount === 0) {
            continue;
        }
        for (let idx = change.spliceStart; idx < change.spliceStart + change.deleteCount; idx += 1) {
            const existing = consumed.get(idx);
            if (existing) {
                throw new Error(`Overlapping operations are not allowed: ${change.label} conflicts with ${existing}`);
            }
            consumed.set(idx, change.label);
        }
    }
    for (const change of changes) {
        if (change.deleteCount !== 0 || change.anchorIndex === undefined) {
            continue;
        }
        const existing = consumed.get(change.anchorIndex);
        if (existing) {
            throw new Error(`Operation conflict: ${change.label} references a line already modified by ${existing}`);
        }
    }
}
function applyChanges(snapshot, changes) {
    const nextLines = [...snapshot.lines];
    const ordered = [...changes].sort((a, b) => {
        if (a.spliceStart !== b.spliceStart) {
            return b.spliceStart - a.spliceStart;
        }
        return b.order - a.order;
    });
    let additions = 0;
    let removals = 0;
    for (const change of ordered) {
        additions += change.insertLines.length;
        removals += change.deleteCount;
        nextLines.splice(change.spliceStart, change.deleteCount, ...change.insertLines);
    }
    return {
        lines: nextLines,
        additions,
        removals,
    };
}
function snapshotFromLines(base, nextLines) {
    const nextRaw = stringifyLines(nextLines, base.eol, base.endsWithNewline);
    const parsed = parseRaw(nextRaw);
    return {
        absolutePath: base.absolutePath,
        ...parsed,
    };
}
async function writeSnapshot(snapshot) {
    await fs.mkdir(path.dirname(snapshot.absolutePath), { recursive: true });
    await fs.writeFile(snapshot.absolutePath, snapshot.raw, "utf8");
}
function formatEditResult(params) {
    return [
        `Hashline ${params.mode} edit ${params.dryRun ? "(dry run) " : ""}completed for ${params.filePath}.`,
        `File hash: ${params.before.fileHash} -> ${params.after.fileHash}`,
        `Operations: ${params.operations}; additions: ${params.additions}; removals: ${params.removals}`,
        `Lines: ${params.before.lines.length} -> ${params.after.lines.length}`,
        "Read the file again before issuing additional hashline refs.",
    ].join("\n");
}
function countOccurrences(haystack, needle) {
    if (needle.length === 0) {
        return 0;
    }
    let count = 0;
    let from = 0;
    while (true) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1) {
            return count;
        }
        count += 1;
        from = idx + needle.length;
    }
}
export async function runHashlineRead(params) {
    const absolutePath = resolveFilePath(params.filePath, params.context);
    const snapshot = await readSnapshot(absolutePath);
    const startLine = Math.max(1, Math.floor(params.offset ?? 1));
    const limit = Math.max(1, Math.floor(params.limit ?? DEFAULT_LIMIT));
    const startIndex = startLine - 1;
    const endIndex = Math.min(snapshot.lines.length, startIndex + limit);
    const body = [];
    for (let idx = startIndex; idx < endIndex; idx += 1) {
        const line = snapshot.lines[idx];
        const displayLine = line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line;
        const ref = `${idx + 1}#${hashlineLineHash(line)}`;
        body.push(`${ref}|${displayLine}`);
    }
    if (snapshot.lines.length === 0) {
        body.push("# file is empty");
    }
    if (startIndex > 0) {
        body.unshift(`# skipped lines: 1-${startIndex}`);
    }
    if (endIndex < snapshot.lines.length) {
        body.push(`# truncated: ${snapshot.lines.length - endIndex} lines not shown`);
    }
    return [
        `<hashline-file path="${absolutePath}" file_hash="${snapshot.fileHash}" total_lines="${snapshot.lines.length}" start_line="${startLine}" shown_until="${endIndex}">`,
        "# format: <line>#<hash>|<content>",
        "# use refs exactly as shown in hashline edit/patch tools",
        ...body,
        "</hashline-file>",
    ].join("\n");
}
export async function runHashlineOperations(params) {
    const absolutePath = resolveFilePath(params.filePath, params.context);
    const existingSnapshot = await readSnapshotIfExists(absolutePath);
    const snapshot = existingSnapshot ?? emptySnapshot(absolutePath);
    const normalizedOps = normalizeOperations(params.operations);
    if (params.expectedFileHash && snapshot.fileHash !== params.expectedFileHash.toUpperCase()) {
        throw new Error(`File hash mismatch for ${params.filePath}. Expected ${params.expectedFileHash.toUpperCase()}, actual ${snapshot.fileHash}. Read the file again before editing.`);
    }
    const changes = resolveChanges(snapshot, normalizedOps);
    validateChangeConflicts(changes);
    const applied = applyChanges(snapshot, changes);
    const after = snapshotFromLines(snapshot, applied.lines);
    if (!params.dryRun) {
        await writeSnapshot(after);
    }
    return formatEditResult({
        filePath: params.filePath,
        mode: "hashline",
        dryRun: Boolean(params.dryRun),
        before: snapshot,
        after,
        operations: normalizedOps.length,
        additions: applied.additions,
        removals: applied.removals,
    });
}
export async function runLegacyEdit(params) {
    const absolutePath = resolveFilePath(params.filePath, params.context);
    const existingSnapshot = await readSnapshotIfExists(absolutePath);
    const snapshot = existingSnapshot ?? emptySnapshot(absolutePath);
    if (params.expectedFileHash && snapshot.fileHash !== params.expectedFileHash.toUpperCase()) {
        throw new Error(`File hash mismatch for ${params.filePath}. Expected ${params.expectedFileHash.toUpperCase()}, actual ${snapshot.fileHash}. Read the file again before editing.`);
    }
    const oldString = params.oldString ?? "";
    const newString = params.newString ?? "";
    let nextRaw = snapshot.raw;
    if (oldString.length === 0) {
        nextRaw = newString;
    }
    else {
        const occurrences = countOccurrences(snapshot.raw, oldString);
        if (occurrences === 0) {
            throw new Error("old_string was not found in file");
        }
        if (occurrences > 1) {
            throw new Error("old_string must match exactly one location");
        }
        const start = snapshot.raw.indexOf(oldString);
        nextRaw = `${snapshot.raw.slice(0, start)}${newString}${snapshot.raw.slice(start + oldString.length)}`;
    }
    const parsed = parseRaw(nextRaw);
    const after = {
        absolutePath,
        ...parsed,
    };
    if (!params.dryRun) {
        await writeSnapshot(after);
    }
    return formatEditResult({
        filePath: params.filePath,
        mode: "legacy",
        dryRun: Boolean(params.dryRun),
        before: snapshot,
        after,
        operations: 1,
        additions: Math.max(0, after.lines.length - snapshot.lines.length),
        removals: Math.max(0, snapshot.lines.length - after.lines.length),
    });
}
export function parsePatchText(patchText) {
    let parsed;
    try {
        parsed = JSON.parse(patchText);
    }
    catch {
        throw new Error("patch_text must be JSON for hashline patching. Use either an array of operations or an object { file_path, operations, expected_file_hash }.");
    }
    if (Array.isArray(parsed)) {
        return {
            operations: parsed,
        };
    }
    if (parsed && typeof parsed === "object") {
        const obj = parsed;
        return {
            filePath: obj.file_path ?? obj.filePath,
            operations: obj.operations,
            expectedFileHash: obj.expected_file_hash ?? obj.expectedFileHash,
        };
    }
    throw new Error("patch_text JSON must be an array or object");
}
export function mapOperationInput(input) {
    return {
        op: input.op,
        ref: input.ref,
        startRef: input.start_ref,
        endRef: input.end_ref,
        content: input.content,
    };
}
