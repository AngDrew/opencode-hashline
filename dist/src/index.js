import { HashlineRouting as routingPlugin } from "../.opencode/plugins/hashline-routing";
import readTool from "../.opencode/tools/read";
import editTool from "../.opencode/tools/edit";
import patchTool from "../.opencode/tools/patch";
import writeTool from "../.opencode/tools/write";
const hashlinePlugin = async (input) => {
    const routingHooks = await routingPlugin(input);
    return {
        ...routingHooks,
        tool: {
            read: readTool,
            edit: editTool,
            patch: patchTool,
            write: writeTool,
        },
    };
};
export default hashlinePlugin;
