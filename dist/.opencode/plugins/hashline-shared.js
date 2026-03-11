import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { hashlineLineHash } from "../tools/hashline-core";
const CONFIG_FILENAME = "opencode-hashline.json";
export const DEFAULT_PREFIX = "#HL ";
export const DEFAULT_EXCLUDE_PATTERNS = [
    "**/node_modules/**",
    "**/*.lock",
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pnpm-lock.yaml",
    "**/*.min.js",
    "**/*.min.css",
    "**/*.map",
    "**/*.wasm",
    "**/*.png",
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.gif",
    "**/*.ico",
    "**/*.svg",
    "**/*.woff",
    "**/*.woff2",
    "**/*.ttf",
    "**/*.eot",
    "**/*.pdf",
    "**/*.zip",
    "**/*.tar",
    "**/*.gz",
    "**/*.exe",
    "**/*.dll",
    "**/*.so",
    "**/*.dylib",
    "**/.env",
    "**/.env.*",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/id_rsa",
    "**/id_rsa.pub",
    "**/id_ed25519",
    "**/id_ed25519.pub",
    "**/id_ecdsa",
    "**/id_ecdsa.pub",
];
export const DEFAULT_HASHLINE_RUNTIME_CONFIG = {
    exclude: DEFAULT_EXCLUDE_PATTERNS,
    maxFileSize: 1_048_576,
    cacheSize: 100,
    prefix: DEFAULT_PREFIX,
    fileRev: true,
    safeReapply: false,
};
function hashText(text, length = 10) {
    return createHash("sha1").update(text, "utf8").digest("hex").slice(0, length).toUpperCase();
}
function sanitizeConfig(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return {};
    }
    const source = input;
    const out = {};
    if (Array.isArray(source.exclude)) {
        out.exclude = source.exclude.filter((item) => typeof item === "string" && item.length > 0 && item.length <= 512);
    }
    if (typeof source.maxFileSize === "number" && Number.isFinite(source.maxFileSize) && source.maxFileSize >= 0) {
        out.maxFileSize = Math.floor(source.maxFileSize);
    }
    if (typeof source.cacheSize === "number" && Number.isFinite(source.cacheSize) && source.cacheSize > 0) {
        out.cacheSize = Math.floor(source.cacheSize);
    }
    if (source.prefix === false) {
        out.prefix = false;
    }
    else if (typeof source.prefix === "string") {
        // Keep prefix simple and printable to avoid prompt/tool injection.
        if (/^[\x20-\x7E]{0,20}$/.test(source.prefix)) {
            out.prefix = source.prefix;
        }
    }
    if (typeof source.fileRev === "boolean") {
        out.fileRev = source.fileRev;
    }
    if (typeof source.safeReapply === "boolean") {
        out.safeReapply = source.safeReapply;
    }
    return out;
}
function readConfigFile(filePath) {
    if (!existsSync(filePath)) {
        return undefined;
    }
    try {
        const raw = readFileSync(filePath, "utf8");
        return sanitizeConfig(JSON.parse(raw));
    }
    catch {
        return undefined;
    }
}
export function resolveHashlineConfig(projectDir) {
    const globalPath = path.join(homedir(), ".config", "opencode", CONFIG_FILENAME);
    const projectPath = projectDir ? path.join(projectDir, CONFIG_FILENAME) : undefined;
    const globalConfig = readConfigFile(globalPath);
    const projectConfig = projectPath ? readConfigFile(projectPath) : undefined;
    return {
        ...DEFAULT_HASHLINE_RUNTIME_CONFIG,
        ...globalConfig,
        ...projectConfig,
        exclude: (projectConfig?.exclude ?? globalConfig?.exclude ?? DEFAULT_EXCLUDE_PATTERNS).slice(),
    };
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function globToRegex(pattern) {
    const normalized = pattern.replace(/\\/g, "/");
    let out = "^";
    for (let i = 0; i < normalized.length; i += 1) {
        const current = normalized[i];
        const next = normalized[i + 1];
        if (current === "*" && next === "*") {
            out += ".*";
            i += 1;
            continue;
        }
        if (current === "*") {
            out += "[^/]*";
            continue;
        }
        if (current === "?") {
            out += ".";
            continue;
        }
        out += escapeRegex(current);
    }
    out += "$";
    return new RegExp(out);
}
const globRegexCache = new Map();
function getGlobRegex(pattern) {
    const cached = globRegexCache.get(pattern);
    if (cached) {
        return cached;
    }
    const compiled = globToRegex(pattern);
    globRegexCache.set(pattern, compiled);
    return compiled;
}
export function shouldExclude(filePath, patterns) {
    const normalized = filePath.replace(/\\/g, "/");
    return patterns.some((pattern) => getGlobRegex(pattern).test(normalized));
}
const textEncoder = new TextEncoder();
export function getByteLength(content) {
    return textEncoder.encode(content).length;
}
export function computeFileRev(content) {
    const normalized = content.includes("\r\n") ? content.replace(/\r\n/g, "\n") : content;
    return hashText(normalized, 8);
}
export function formatWithHashline(content, options) {
    const effectivePrefix = options?.prefix === undefined ? DEFAULT_PREFIX : options.prefix === false ? "" : options.prefix;
    const normalized = content.includes("\r\n") ? content.replace(/\r\n/g, "\n") : content;
    const lines = normalized.split("\n");
    const output = [];
    if (options?.includeFileRev) {
        output.push(`${effectivePrefix}REV:${computeFileRev(normalized)}`);
    }
    for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        output.push(`${effectivePrefix}${idx + 1}#${hashlineLineHash(line)}|${line}`);
    }
    return output.join("\n");
}
export function stripHashlinePrefixes(content, prefix) {
    const effectivePrefix = prefix === undefined ? DEFAULT_PREFIX : prefix === false ? "" : prefix;
    const escapedPrefix = escapeRegex(effectivePrefix);
    const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
    const normalized = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;
    const refPattern = new RegExp(`^([+\\- ])?${escapedPrefix}\\d+\\s*[#: ]\\s*[A-Za-z0-9]+\\|`);
    const revPattern = new RegExp(`^${escapedPrefix}REV:[A-Za-z0-9]{8}$`);
    const stripped = normalized
        .split("\n")
        .filter((line) => !revPattern.test(line))
        .map((line) => {
        const match = line.match(refPattern);
        if (!match) {
            return line;
        }
        const marker = match[1] ?? "";
        return marker + line.slice(match[0].length);
    })
        .join("\n");
    return lineEnding === "\r\n" ? stripped.replace(/\n/g, "\r\n") : stripped;
}
export class HashlineAnnotationCache {
    maxSize;
    entries = new Map();
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
    }
    get(key, source) {
        const entry = this.entries.get(key);
        if (!entry) {
            return null;
        }
        const currentHash = hashText(source, 12);
        if (entry.sourceHash !== currentHash) {
            this.entries.delete(key);
            return null;
        }
        // Refresh LRU order
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.annotated;
    }
    set(key, source, annotated) {
        if (this.entries.has(key)) {
            this.entries.delete(key);
        }
        if (this.entries.size >= this.maxSize) {
            const oldestKey = this.entries.keys().next().value;
            if (typeof oldestKey === "string") {
                this.entries.delete(oldestKey);
            }
        }
        this.entries.set(key, {
            sourceHash: hashText(source, 12),
            annotated,
        });
    }
    invalidate(key) {
        this.entries.delete(key);
    }
    clear() {
        this.entries.clear();
    }
}
export function extractPathFromToolArgs(args) {
    if (!args) {
        return undefined;
    }
    const candidate = args.path ?? args.filePath ?? args.file_path ?? args.file;
    return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}
