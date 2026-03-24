import type { Plugin } from "@opencode-ai/plugin"
import { createHashlineHooks } from "./hashline-hooks.js"
import { HashlineAnnotationCache, resolveHashlineConfig } from "./hashline-shared.js"

/**
 * Hashline routing only normalizes tool arguments and aliases tool names.
 *
 * It does not perform the actual hashline read/edit/write work; that lives in
 * hashline-hooks.ts, which handles the heavy lifting against the core runtime.
 */

const known = new Set(["read", "view", "edit", "patch", "write"])

function normalizeName(name: string): string {
  return name === "view" ? "read" : name
}

function normalizeArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args }

  // The native read contract expects `filePath`, while the rest of the routing
  // layer keeps the legacy snake_case -> camelCase bridge for edit-style tools.
  if (toolName === "read") {
    if (typeof out.filePath !== "string") {
      if (typeof out.path === "string") out.filePath = out.path
      else if (typeof out.file_path === "string") out.filePath = out.file_path
      else if (typeof out.file === "string") out.filePath = out.file
    }
  }

  if (toolName === "edit") {
    if (typeof out.file_path === "string" && typeof out.filePath !== "string") out.filePath = out.file_path
    if (typeof out.start_ref === "string" && typeof out.startRef !== "string") out.startRef = out.start_ref
    if (typeof out.end_ref === "string" && typeof out.endRef !== "string") out.endRef = out.end_ref
    if (typeof out.safe_reapply === "boolean" && typeof out.safeReapply !== "boolean") out.safeReapply = out.safe_reapply
    if (typeof out.expected_file_hash === "string" && typeof out.expectedFileHash !== "string") out.expectedFileHash = out.expected_file_hash
    if (typeof out.file_rev === "string" && typeof out.fileRev !== "string") out.fileRev = out.file_rev
    if (typeof out.dry_run === "boolean" && typeof out.dryRun !== "boolean") out.dryRun = out.dry_run
  }

  if (toolName === "patch") {
    if (typeof out.patch_text === "string" && typeof out.patchText !== "string") out.patchText = out.patch_text
    if (typeof out.file_path === "string" && typeof out.filePath !== "string") out.filePath = out.file_path
    if (typeof out.expected_file_hash === "string" && typeof out.expectedFileHash !== "string") out.expectedFileHash = out.expected_file_hash
    if (typeof out.file_rev === "string" && typeof out.fileRev !== "string") out.fileRev = out.file_rev
    if (typeof out.dry_run === "boolean" && typeof out.dryRun !== "boolean") out.dryRun = out.dry_run
  }

  if (toolName === "write") {
    if (typeof out.file_path === "string" && typeof out.filePath !== "string") out.filePath = out.file_path
    if (typeof out.expected_file_hash === "string" && typeof out.expectedFileHash !== "string") out.expectedFileHash = out.expected_file_hash
    if (typeof out.file_rev === "string" && typeof out.fileRev !== "string") out.fileRev = out.file_rev
    if (typeof out.dry_run === "boolean" && typeof out.dryRun !== "boolean") out.dryRun = out.dry_run
  }

  return out
}

export const HashlineRouting: Plugin = async (input) => {
  const projectDirectory = typeof input?.directory === "string" ? input.directory : undefined
  const config = resolveHashlineConfig(projectDirectory)
  const cache = new HashlineAnnotationCache(config.cacheSize ?? 128)
  const hooks = createHashlineHooks(config, cache)

  return {
    ...hooks,
    "tool.execute.before": async (input, output) => {
      const name = normalizeName(input.tool)
      if (known.has(name)) {
        output.args = normalizeArgs(name, (output.args ?? {}) as Record<string, unknown>)
      }

      if (hooks["tool.execute.before"]) {
        await hooks["tool.execute.before"](input, output)
      }
    },
  }
}
