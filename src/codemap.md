# src/

## Responsibility

- Provides the **OpenCode plugin entrypoint** for this repository.
- Exposes the **Hashline tool suite** (line-stable file operations) to the OpenCode runtime via `tool.read`, `tool.edit`, `tool.patch`, and `tool.write`.
- Composes routing/dispatch behavior from `HashlineRouting` so tool calls are routed consistently.

Primary module:
- `src/index.ts`: exports the default plugin factory `hashlinePlugin`.

## Design

- **Plugin factory**: `const hashlinePlugin: Plugin = async (input) => { ... }` (default export).
  - Uses the `Plugin` type from `@opencode-ai/plugin`.
  - Returns a single object that merges:
    - routing hooks from `HashlineRouting` (imported as `routingPlugin`), and
    - a `tool` map with concrete tool handlers.

- **Tool registration** (wiring only, implementations live outside `src/`):
  - `readTool` imported from `../.opencode/tools/read`
  - `editTool` imported from `../.opencode/tools/edit`
  - `patchTool` imported from `../.opencode/tools/patch`
  - `writeTool` imported from `../.opencode/tools/write`

- **Routing composition**:
  - `HashlineRouting` is imported from `../.opencode/plugins/hashline-routing` as `routingPlugin`.
  - `routingHooks` is produced by `await routingPlugin(input)` and spread into the plugin return value.

Overall, `src/` is intentionally minimal: it is the **assembly layer** that binds routing + tool handlers into an OpenCode-compatible plugin export.

## Flow

1. OpenCode loads `src/index.ts` and executes the default export `hashlinePlugin(input)`.
2. `hashlinePlugin` awaits routing initialization:
   - `const routingHooks = await routingPlugin(input)`
3. `hashlinePlugin` returns the plugin contract:
   - `return { ...routingHooks, tool: { read, edit, patch, write } }`
4. At runtime, OpenCode invokes tools via `tool.<name>`; routing hooks (from `HashlineRouting`) participate in dispatch as provided by `routingHooks`.

## Integration

- **External runtime contract**: `@opencode-ai/plugin` (`Plugin` type) defines the expected shape/behavior of the exported plugin factory.
- **Routing integration**: `../.opencode/plugins/hashline-routing` provides `HashlineRouting` (imported as `routingPlugin`) whose returned hooks are merged into the exported plugin.
- **Tool integration**: `../.opencode/tools/{read,edit,patch,write}` supply the concrete tool handlers registered under `tool`.

Entry point used by the host:
- `src/index.ts` (default export: `hashlinePlugin`).
