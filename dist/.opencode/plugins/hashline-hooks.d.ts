import type { Hooks } from "@opencode-ai/plugin";
import { HashlineAnnotationCache, type HashlineRuntimeConfig } from "./hashline-shared";
type HashlinePluginHooks = Pick<Hooks, "tool.execute.before" | "tool.execute.after" | "experimental.chat.system.transform" | "chat.message">;
export declare function createHashlineHooks(config: HashlineRuntimeConfig, cache: HashlineAnnotationCache): HashlinePluginHooks;
export {};
