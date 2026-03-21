import type { Plugin } from "@opencode-ai/plugin"
import { createHashlineHooks } from "./hashline-hooks"
import { HashlineAnnotationCache, resolveHashlineConfig } from "./hashline-shared"

const HASHLINE_TOOLS = new Set(["read", "edit", "patch", "write", "hash-check"])

function canonicalToolName(name: string): string {
  const lower = name.toLowerCase()
  const splitIndex = lower.lastIndexOf(".")
  return splitIndex >= 0 ? lower.slice(splitIndex + 1) : lower
}

function setStringAlias(args: Record<string, unknown>, canonicalKey: string, aliasKey: string): void {
  const canonical = args[canonicalKey]
  const alias = args[aliasKey]
  const canonicalMissing = typeof canonical !== "string" || canonical.trim().length === 0
  if (typeof alias === "string" && alias.trim().length > 0 && canonicalMissing) {
    args[canonicalKey] = alias
  }
}

function setBooleanAlias(args: Record<string, unknown>, canonicalKey: string, aliasKey: string): void {
  const canonical = args[canonicalKey]
  const alias = args[aliasKey]
  if (typeof alias === "boolean" && typeof canonical !== "boolean") {
    args[canonicalKey] = alias
  }
}

function normalizeOperationAliasesInPlace(operation: unknown): void {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    return
  }

  const op = operation as Record<string, unknown>
  setStringAlias(op, "startRef", "start_ref")
  setStringAlias(op, "endRef", "end_ref")
  setStringAlias(op, "content", "replacement")
}
function normalizeArgsInPlace(toolName: string, args: Record<string, unknown>): void {
  if (toolName === "read") {
    setStringAlias(args, "filePath", "file_path")
    return
  }

  if (toolName === "edit") {
    setStringAlias(args, "filePath", "file_path")
    setStringAlias(args, "startRef", "start_ref")
    setStringAlias(args, "endRef", "end_ref")
    setBooleanAlias(args, "safeReapply", "safe_reapply")
    setStringAlias(args, "expectedFileHash", "expected_file_hash")
    setStringAlias(args, "fileRev", "file_rev")
    setBooleanAlias(args, "dryRun", "dry_run")
    const operations = args.operations
    if (Array.isArray(operations)) {
      for (const operation of operations) {
        normalizeOperationAliasesInPlace(operation)
      }
    }
    return
  }

  if (toolName === "patch") {
    setStringAlias(args, "patchText", "patch_text")
    setStringAlias(args, "filePath", "file_path")
    setStringAlias(args, "expectedFileHash", "expected_file_hash")
    setStringAlias(args, "fileRev", "file_rev")
    setBooleanAlias(args, "dryRun", "dry_run")
    return
  }

  if (toolName === "write") {
    setStringAlias(args, "filePath", "file_path")
    setStringAlias(args, "expectedFileHash", "expected_file_hash")
    setStringAlias(args, "fileRev", "file_rev")
    setBooleanAlias(args, "dryRun", "dry_run")
  }

  if (toolName === "hash-check") {
    setStringAlias(args, "filePath", "file_path")
    setStringAlias(args, "expectedFileHash", "expected_file_hash")
    setStringAlias(args, "fileRev", "file_rev")
    setBooleanAlias(args, "safeReapply", "safe_reapply")
  }
}

export const HashlineRouting: Plugin = async (input) => {
  const projectDirectory = typeof input?.directory === "string" ? input.directory : undefined
  const config = resolveHashlineConfig(projectDirectory)
  const cache = new HashlineAnnotationCache(config.cacheSize ?? 128)
  const hooks = createHashlineHooks(config, cache)

  return {
    ...hooks,
    "tool.execute.before": async (input, output) => {
      const name = canonicalToolName(input.tool)
      if (!HASHLINE_TOOLS.has(name)) {
        if (hooks["tool.execute.before"]) {
          await hooks["tool.execute.before"](input, output)
        }
        return
      }

      if (output.args && typeof output.args === "object" && !Array.isArray(output.args)) {
        normalizeArgsInPlace(name, output.args as Record<string, unknown>)
      }

      if (hooks["tool.execute.before"]) {
        await hooks["tool.execute.before"](input, output)
      }
    },
  }
}
