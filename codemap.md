# Repository Atlas: hashline read edit

## Project Responsibility
Provides an OpenCode plugin package that overrides core file tools (`hash-read`, `hash-edit`, `hash-patch`, `hash-write`) with hashline-aware implementations. The plugin adds line-stable references and patch semantics so agents can apply deterministic, collision-resistant edits across iterative tool calls.

## System Entry Points
- `src/index.ts`: Plugin entrypoint (`hashlinePlugin`) that composes routing hooks and registers tool handlers.
- `package.json`: Package metadata, build/publish scripts, benchmark scripts (`bench`, `bench:legacy`), export map (`./dist/src/index.js`), and peer dependency on `@opencode-ai/plugin`.
- `opencode.json`: Local OpenCode runtime config enabling the `hashline-routing` plugin and defining a constrained smoke-test agent.
- `.opencode/plugins/hashline-routing.ts`: Routing integration layer used by `src/index.ts` to inject hook behavior.
- `.opencode/tools/{hash-read,hash-edit,hash-patch,hash-write}.ts`: Hashline tool implementations wired into the plugin.
- `bench/runner.mjs`: Primary benchmark harness (performance + correctness + gate output).
- `bench/cases.json`: Benchmark matrix/scenarios and gate thresholds.
- `scripts/benchmark.mjs`: Legacy benchmark runner retained for comparison (`npm run bench:legacy`).
- `.github/workflows/{ci,publish}.yml`: CI validation and npm publish automation on version tags.

## Repository Directory Map (Aggregated)
| Directory | Responsibility Summary | Detailed Map |
|-----------|------------------------|--------------|
| `src/` | Plugin assembly layer that exports `hashlinePlugin`, merges routing hooks, and registers hashline tool handlers. | [View Map](src/codemap.md) |
| `bench/` | Benchmark harness and scenario matrix for performance/correctness gates. | [View Map](bench/codemap.md) |

## Runtime Flow (Top-Level)
1. OpenCode loads plugin from `src/index.ts`.
2. `hashlinePlugin(input)` awaits `HashlineRouting(input)` to obtain routing hooks.
3. Plugin returns `{ ...routingHooks, tool: { "hash-read": hashReadTool, "hash-edit": hashEditTool, "hash-patch": hashPatchTool, "hash-write": hashWriteTool } }`.
4. Host dispatches file operations through hashline-aware tool handlers in `.opencode/tools`.
