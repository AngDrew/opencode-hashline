"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HashlineRouting = void 0;
const known = new Set(["read", "view", "edit", "patch", "write"]);
function normalizeName(name) {
    return name === "view" ? "read" : name;
}
function normalizeArgs(toolName, args) {
    const out = { ...args };
    if (toolName === "read") {
        if (typeof out.filePath === "string" && typeof out.file_path !== "string") {
            out.file_path = out.filePath;
        }
        if (typeof out.file_path === "string" && typeof out.filePath !== "string") {
            out.filePath = out.file_path;
        }
    }
    if (toolName === "edit") {
        if (typeof out.filePath === "string" && typeof out.file_path !== "string") {
            out.file_path = out.filePath;
        }
        if (typeof out.file_path === "string" && typeof out.filePath !== "string") {
            out.filePath = out.file_path;
        }
        if (typeof out.oldString === "string" && typeof out.old_string !== "string") {
            out.old_string = out.oldString;
        }
        if (typeof out.old_string === "string" && typeof out.oldString !== "string") {
            out.oldString = out.old_string;
        }
        if (typeof out.newString === "string" && typeof out.new_string !== "string") {
            out.new_string = out.newString;
        }
        if (typeof out.new_string === "string" && typeof out.newString !== "string") {
            out.newString = out.new_string;
        }
    }
    if (toolName === "patch") {
        if (typeof out.patchText === "string" && typeof out.patch_text !== "string") {
            out.patch_text = out.patchText;
        }
        if (typeof out.patch_text === "string" && typeof out.patchText !== "string") {
            out.patchText = out.patch_text;
        }
        if (typeof out.filePath === "string" && typeof out.file_path !== "string") {
            out.file_path = out.filePath;
        }
        if (typeof out.file_path === "string" && typeof out.filePath !== "string") {
            out.filePath = out.file_path;
        }
    }
    if (toolName === "write") {
        if (typeof out.filePath === "string" && typeof out.file_path !== "string") {
            out.file_path = out.filePath;
        }
        if (typeof out.file_path === "string" && typeof out.filePath !== "string") {
            out.filePath = out.file_path;
        }
    }
    return out;
}
const HashlineRouting = async () => {
    return {
        "tool.execute.before": async (input, output) => {
            const name = normalizeName(input.tool);
            if (!known.has(name)) {
                return;
            }
            output.tool = name;
            const nextArgs = normalizeArgs(name, (output.args ?? {}));
            output.args = nextArgs;
        },
    };
};
exports.HashlineRouting = HashlineRouting;
