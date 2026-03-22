import type { Plugin } from "@opencode-ai/plugin"
import { HashlineRouting as routingPlugin } from "../.opencode/plugins/hashline-routing"
import { hashlineResolveEditTool } from "../.opencode/tools/resolve-hash-edit"

const hashlinePlugin: Plugin = async (input) => {
  const routingHooks = await routingPlugin(input)

  return {
    ...routingHooks,
    // Register helper tool for hashline-to-native edit conversion
    tool: {
      resolve_hash_edit: hashlineResolveEditTool,
    },
    // Don't override read/edit/write/patch - let OpenCode's native tools handle them
    // The hooks will intercept and transform inputs/outputs
  }
}

export default hashlinePlugin
