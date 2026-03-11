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
    if (typeof out.oldString === "string" && typeof out.old_string !== "string") {
      out.old_string = out.oldString
    }
    if (typeof out.old_string === "string" && typeof out.oldString !== "string") {
      out.oldString = out.old_string
    }
    if (typeof out.newString === "string" && typeof out.new_string !== "string") {
      out.new_string = out.newString
    }
    if (typeof out.new_string === "string" && typeof out.newString !== "string") {
      out.newString = out.new_string
    }
    if (typeof out.fileRev === "string" && typeof out.file_rev !== "string") {
      out.file_rev = out.fileRev
    }
    if (typeof out.file_rev === "string" && typeof out.fileRev !== "string") {
      out.fileRev = out.file_rev
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
