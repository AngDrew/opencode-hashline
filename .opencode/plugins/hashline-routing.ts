import type { Plugin } from "@opencode-ai/plugin"
import { createHashlineHooks } from "./hashline-hooks"
import { HashlineAnnotationCache, resolveHashlineConfig } from "./hashline-shared"

const known = new Set(["read", "view", "edit", "patch", "write"])

function normalizeName(name: string): string {
  return name === "view" ? "read" : name
}

function normalizeArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args }

  if (toolName === "read") {
    if (typeof out.filePath === "string" && typeof out.file_path !== "string") {
      out.file_path = out.filePath
    }
    if (typeof out.file_path === "string" && typeof out.filePath !== "string") {
      out.filePath = out.file_path
    }
  }

  if (toolName === "edit") {
    if (typeof out.filePath === "string" && typeof out.file_path !== "string") {
      out.file_path = out.filePath
    }
    if (typeof out.file_path === "string" && typeof out.filePath !== "string") {
      out.filePath = out.file_path
    }
    if (typeof out.startRef === "string" && typeof out.start_ref !== "string") {
      out.start_ref = out.startRef
    }
    if (typeof out.start_ref === "string" && typeof out.startRef !== "string") {
      out.startRef = out.start_ref
    }
    if (typeof out.endRef === "string" && typeof out.end_ref !== "string") {
      out.end_ref = out.endRef
    }
    if (typeof out.end_ref === "string" && typeof out.endRef !== "string") {
      out.endRef = out.end_ref
    }
    if (typeof out.safeReapply === "boolean" && typeof out.safe_reapply !== "boolean") {
      out.safe_reapply = out.safeReapply
    }
    if (typeof out.safe_reapply === "boolean" && typeof out.safeReapply !== "boolean") {
      out.safeReapply = out.safe_reapply
    }
    if (typeof out.expectedFileHash === "string" && typeof out.expected_file_hash !== "string") {
      out.expected_file_hash = out.expectedFileHash
    }
    if (typeof out.expected_file_hash === "string" && typeof out.expectedFileHash !== "string") {
      out.expectedFileHash = out.expected_file_hash
    }
    if (typeof out.fileRev === "string" && typeof out.file_rev !== "string") {
      out.file_rev = out.fileRev
    }
    if (typeof out.file_rev === "string" && typeof out.fileRev !== "string") {
      out.fileRev = out.file_rev
    }
    if (typeof out.dryRun === "boolean" && typeof out.dry_run !== "boolean") {
      out.dry_run = out.dryRun
    }
    if (typeof out.dry_run === "boolean" && typeof out.dryRun !== "boolean") {
      out.dryRun = out.dry_run
    }
  }

  if (toolName === "patch") {
    if (typeof out.patchText === "string" && typeof out.patch_text !== "string") {
      out.patch_text = out.patchText
    }
    if (typeof out.patch_text === "string" && typeof out.patchText !== "string") {
      out.patchText = out.patch_text
    }
    if (typeof out.filePath === "string" && typeof out.file_path !== "string") {
      out.file_path = out.filePath
    }
    if (typeof out.file_path === "string" && typeof out.filePath !== "string") {
      out.filePath = out.file_path
    }
    if (typeof out.fileRev === "string" && typeof out.file_rev !== "string") {
      out.file_rev = out.fileRev
    }
    if (typeof out.file_rev === "string" && typeof out.fileRev !== "string") {
      out.fileRev = out.file_rev
    }
  }

  if (toolName === "write") {
    if (typeof out.filePath === "string" && typeof out.file_path !== "string") {
      out.file_path = out.filePath
    }
    if (typeof out.file_path === "string" && typeof out.filePath !== "string") {
      out.filePath = out.file_path
    }
    if (typeof out.fileRev === "string" && typeof out.file_rev !== "string") {
      out.file_rev = out.fileRev
    }
    if (typeof out.file_rev === "string" && typeof out.fileRev !== "string") {
      out.fileRev = out.file_rev
    }
  }

  return out
}

export const HashlineRouting: Plugin = async (input) => {
  const projectDirectory = typeof input?.directory === "string" ? input.directory : undefined
  const config = resolveHashlineConfig(projectDirectory)
  const cache = new HashlineAnnotationCache(config.cacheSize)
  const hooks = createHashlineHooks(config, cache)

  return {
    ...hooks,
    "tool.execute.before": async (input, output) => {
      const name = normalizeName(input.tool)
      if (!known.has(name)) {
        if (hooks["tool.execute.before"]) {
          await hooks["tool.execute.before"](input, output)
        }
        return
      }

      const nextArgs = normalizeArgs(name, (output.args ?? {}) as Record<string, unknown>)
      output.args = nextArgs

      if (hooks["tool.execute.before"]) {
        await hooks["tool.execute.before"](input, output)
      }
    },
  }
}
