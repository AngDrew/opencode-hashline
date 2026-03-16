import type { Plugin } from "@opencode-ai/plugin"
import { HashlineRouting as routingPlugin } from "../.opencode/plugins/hashline-routing"
import hashReadTool from "../.opencode/tools/hash-read"
import hashEditTool from "../.opencode/tools/hash-edit"
import hashPatchTool from "../.opencode/tools/hash-patch"
import hashWriteTool from "../.opencode/tools/hash-write"
import hashCheckTool from "../.opencode/tools/hash-check"

const hashlinePlugin: Plugin = async (input) => {
  const routingHooks = await routingPlugin(input as unknown as Parameters<typeof routingPlugin>[0])

  return {
    ...routingHooks,
    tool: {
      "hash-read": hashReadTool,
      "hash-edit": hashEditTool,
      "hash-patch": hashPatchTool,
      "hash-write": hashWriteTool,
      "hash-check": hashCheckTool,
    },
  }
}

export default hashlinePlugin
