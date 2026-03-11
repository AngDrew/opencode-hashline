import path from "node:path";
import { promises as fs, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { extractPathFromToolArgs, formatWithHashline, getByteLength, shouldExclude, stripHashlinePrefixes, } from "./hashline-shared";
const FILE_READ_TOOLS = ["read", "file_read", "read_file", "cat", "view"];
const FILE_EDIT_TOOLS = ["edit", "write", "patch", "apply_patch", "file_edit", "file_write", "edit_file", "multiedit", "batch"];
function toolEndsWith(tool, known) {
    const lower = tool.toLowerCase();
    return known.some((item) => lower === item || lower.endsWith(`.${item}`));
}
function isFileReadTool(tool, args) {
    if (toolEndsWith(tool, FILE_READ_TOOLS)) {
        return true;
    }
    const candidate = extractPathFromToolArgs(args);
    if (!candidate) {
        return false;
    }
    const lower = tool.toLowerCase();
    const writeHints = ["write", "edit", "patch", "execute", "run", "command", "shell", "bash"];
    return !writeHints.some((hint) => lower.includes(hint));
}
function isFileEditTool(tool) {
    return toolEndsWith(tool, FILE_EDIT_TOOLS);
}
const CONTENT_FIELD_KEYS = new Set([
    "content",
    "new_content",
    "old_content",
    "old_string",
    "new_string",
    "replacement",
    "text",
    "diff",
    "patch",
    "patch_text",
    "patchText",
    "body",
]);
function stripNestedHashes(value, prefix) {
    if (typeof value === "string") {
        return stripHashlinePrefixes(value, prefix);
    }
    if (Array.isArray(value)) {
        return value.map((entry) => stripNestedHashes(entry, prefix));
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    const out = { ...value };
    for (const key of Object.keys(out)) {
        if (CONTENT_FIELD_KEYS.has(key)) {
            out[key] = stripNestedHashes(out[key], prefix);
            continue;
        }
        const candidate = out[key];
        if (Array.isArray(candidate) || (candidate && typeof candidate === "object")) {
            out[key] = stripNestedHashes(candidate, prefix);
        }
    }
    return out;
}
function addSystemInstruction(output, config) {
    if (!Array.isArray(output.system)) {
        output.system = [];
    }
    const prefix = config.prefix === false ? "" : config.prefix;
    output.system.push([
        "## Hashline — Line Reference System",
        "",
        `File contents are annotated with hashline prefixes in the format \`${prefix}<line>:<hash>|<content>\`.`,
        "Use refs exactly as shown in read output when editing.",
        "",
        "### Preferred edit path",
        "- Use hash-aware operations (`edit` operations[] or `patch` patch_text JSON) with refs like `12#ABCD`.",
        "- Optionally pass expected file hash (`expected_file_hash`) to guard against stale writes.",
        "",
        "### Dedicated hashline_edit tool",
        "- Supports replace/delete/insert_before/insert_after with refs.",
        "- Supports `fileRev` check from read output `#HL REV:<hash>`.",
        "- Supports `safeReapply: true` for line relocation when unique.",
        "",
        "### Structured errors",
        "- HASH_MISMATCH",
        "- FILE_REV_MISMATCH",
        "- AMBIGUOUS_REAPPLY",
        "- TARGET_OUT_OF_RANGE",
        "- INVALID_REF",
        "- INVALID_RANGE",
        "- MISSING_REPLACEMENT",
        "",
        "Re-read file before issuing new refs after any edit.",
    ].join("\n"));
}
let tempDirPromise = null;
let tempDirPath = null;
let tempCleanupRegistered = false;
async function getTempDirectory() {
    if (!tempDirPromise) {
        tempDirPromise = fs.mkdtemp(path.join(tmpdir(), "hashline-chat-")).then((dir) => {
            tempDirPath = dir;
            if (!tempCleanupRegistered) {
                tempCleanupRegistered = true;
                process.on("exit", () => {
                    if (!tempDirPath) {
                        return;
                    }
                    try {
                        rmSync(tempDirPath, { recursive: true, force: true });
                    }
                    catch {
                        // ignore cleanup errors on exit
                    }
                });
            }
            return dir;
        });
    }
    return tempDirPromise;
}
async function writeAnnotatedTempFile(content) {
    const tempDir = await getTempDirectory();
    const fileName = `hl-${Date.now()}-${randomBytes(6).toString("hex")}.txt`;
    const tempPath = path.join(tempDir, fileName);
    await fs.writeFile(tempPath, content, "utf8");
    return tempPath;
}
async function annotateChatMessageParts(output, input, config, cache) {
    if (!Array.isArray(output.parts) || output.parts.length === 0) {
        return;
    }
    const contextDirectory = typeof input.directory === "string" ? input.directory : process.cwd();
    for (const part of output.parts) {
        if (!part || part.type !== "file") {
            continue;
        }
        const url = typeof part.url === "string" ? part.url : undefined;
        if (!url || !url.startsWith("file://")) {
            continue;
        }
        let absolutePath;
        try {
            absolutePath = path.normalize(fileURLToPath(url));
        }
        catch {
            continue;
        }
        if (shouldExclude(absolutePath, config.exclude)) {
            continue;
        }
        let source;
        try {
            source = await fs.readFile(absolutePath, "utf8");
        }
        catch {
            continue;
        }
        if (config.maxFileSize > 0 && getByteLength(source) > config.maxFileSize) {
            continue;
        }
        const cacheKey = path.isAbsolute(absolutePath)
            ? absolutePath
            : path.resolve(contextDirectory, absolutePath);
        const cached = cache.get(cacheKey, source);
        const annotated = cached ??
            formatWithHashline(source, {
                prefix: config.prefix,
                includeFileRev: config.fileRev,
            });
        if (!cached) {
            cache.set(cacheKey, source, annotated);
        }
        const tempPath = await writeAnnotatedTempFile(annotated);
        part.url = `file://${tempPath}`;
        part.content = annotated;
    }
}
export function createHashlineHooks(config, cache) {
    return {
        "tool.execute.before": async (input, output) => {
            const name = input.tool;
            if (!isFileEditTool(name)) {
                return;
            }
            const args = (output.args ?? {});
            output.args = stripNestedHashes(args, config.prefix);
        },
        "tool.execute.after": async (input, output) => {
            const args = (input.args ?? {});
            if (!isFileReadTool(input.tool, args)) {
                return;
            }
            if (typeof output.output !== "string") {
                return;
            }
            const source = output.output;
            if (source.includes("<hashline-file ") || source.includes("# format: <line>#<hash>|<content>")) {
                return;
            }
            if (config.maxFileSize > 0 && getByteLength(source) > config.maxFileSize) {
                return;
            }
            const filePathFromArgs = extractPathFromToolArgs(args);
            if (typeof filePathFromArgs === "string" && shouldExclude(filePathFromArgs, config.exclude)) {
                return;
            }
            const cacheKey = filePathFromArgs ?? `${input.tool}:${source.length}`;
            const cached = cache.get(cacheKey, source);
            if (cached) {
                output.output = cached;
                return;
            }
            const annotated = formatWithHashline(source, {
                prefix: config.prefix,
                includeFileRev: config.fileRev,
            });
            cache.set(cacheKey, source, annotated);
            output.output = annotated;
        },
        "experimental.chat.system.transform": async (_input, output) => {
            addSystemInstruction(output, config);
        },
        "chat.message": async (input, output) => {
            await annotateChatMessageParts(output, input, config, cache);
        },
    };
}
