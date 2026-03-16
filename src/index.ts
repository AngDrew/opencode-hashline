import type { Plugin } from "@opencode-ai/plugin"
import { HashlineRouting as routingPlugin } from "../.opencode/plugins/hashline-routing"
import readTool from "../.opencode/tools/read"
import editTool from "../.opencode/tools/edit"
import patchTool from "../.opencode/tools/patch"
import writeTool from "../.opencode/tools/write"
import hashCheckTool from "../.opencode/tools/hash-check"

const hashlinePlugin: Plugin = async (input) => {
  const routingHooks = await routingPlugin(input as unknown as Parameters<typeof routingPlugin>[0])

  return {
    ...routingHooks,
    tool: {
      read: readTool,
      edit: editTool,
      patch: patchTool,
      write: writeTool,
      "hash-check": hashCheckTool,
    }
  }
}

export default hashlinePlugin
