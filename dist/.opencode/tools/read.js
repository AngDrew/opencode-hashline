"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_1 = require("@opencode-ai/plugin");
const hashline_core_1 = require("./hashline-core");
exports.default = (0, plugin_1.tool)({
    description: "Hashline file reader. Returns line-stable refs in format <line>#<hash>|<content> to support precise edits.",
    args: {
        filePath: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Absolute or workspace-relative file path to read."),
        file_path: plugin_1.tool.schema
            .string()
            .optional()
            .describe("Absolute or workspace-relative file path to read."),
        offset: plugin_1.tool.schema
            .number()
            .int()
            .positive()
            .optional()
            .describe("1-based starting line number. Defaults to 1."),
        limit: plugin_1.tool.schema
            .number()
            .int()
            .positive()
            .optional()
            .describe("Maximum number of lines to return. Defaults to 2000."),
    },
    async execute(args, context) {
        const filePath = args.filePath ?? args.file_path;
        if (!filePath) {
            throw new Error("Missing file path. Provide filePath (preferred) or file_path.");
        }
        return (0, hashline_core_1.runHashlineRead)({
            filePath,
            offset: args.offset,
            limit: args.limit,
            context,
        });
    },
});
