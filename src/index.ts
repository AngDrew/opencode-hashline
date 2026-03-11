import type { Plugin } from "@opencode-ai/plugin"
import { HashlineRouting as routingPlugin } from "../.opencode/plugins/hashline-routing"
import readTool from "../.opencode/tools/read"
import editTool from "../.opencode/tools/edit"
import patchTool from "../.opencode/tools/patch"
import writeTool from "../.opencode/tools/write"
import hashlineEditTool from "../.opencode/tools/hashline_edit"

const hashlinePlugin: Plugin = async (input) => {
  const routingHooks = await routingPlugin(input)

  return {
    ...routingHooks,
    tool: {
      read: readTool,
      edit: editTool,
      patch: patchTool,
      write: writeTool,
      hashline_edit: hashlineEditTool,
    },
  }
}

export default hashlinePlugin
