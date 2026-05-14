import type { Plugin } from "@opencode-ai/plugin"
import { resolveHashlineConfig, HashlineAnnotationCache } from "./shared.js"
import { createHashlineHooks } from "./hooks.js"
import { createEditTool } from "./edit-tool.js"

const hashlinePlugin: Plugin = async (input) => {
  const projectDirectory = typeof input?.directory === "string" ? input.directory : undefined
  const config = resolveHashlineConfig(projectDirectory)
  const cache = new HashlineAnnotationCache(config.cacheSize ?? 128)
  const hooks = createHashlineHooks(config, cache)
  const editTool = createEditTool()

  return {
    ...hooks,
    tool: {
      edit: editTool,
    },
  }
}

export default hashlinePlugin
