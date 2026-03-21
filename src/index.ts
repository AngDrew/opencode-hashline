import type { Plugin } from "@opencode-ai/plugin"
import { HashlineRouting as routingPlugin } from "../.opencode/plugins/hashline-routing"

const hashlinePlugin: Plugin = async (input) => {
  const routingHooks = await routingPlugin(input)

  return {
    ...routingHooks,
    // Don't override read/edit/write/patch - let OpenCode's native tools handle them
    // The hooks will intercept and transform inputs/outputs
  }
}

export default hashlinePlugin
