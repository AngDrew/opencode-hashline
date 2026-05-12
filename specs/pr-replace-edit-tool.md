# Replace built-in edit tool with custom hashline edit tool

## Problem

The hashline plugin annotates Read tool output with `#HL` line refs (e.g. `12#A3F#9BC`) and `REV` tokens so the LLM can make precise, hash-verified edits. Previously, we tried to extend the native Edit tool's JSON Schema at runtime via the `tool.definition` hook, adding `operations`/`fileRev`/`safeReapply` fields alongside the existing `oldString`/`newString`.

This approach failed. Session export inspection confirmed that **every edit call used `oldString`/`newString`** -- the schema extension either didn't propagate to the LLM or wasn't persuasive enough to override trained behavior. The hashline refs were generated but never consumed.

## Solution

Replace the built-in `edit` tool entirely with a custom tool (`.opencode/tools/edit.ts`) that **only accepts hashline-style args**. Per the OpenCode docs: "If a custom tool uses the same name as a built-in tool, the custom tool takes precedence."

The custom tool schema has no `oldString`/`newString`. The LLM must use `operations[]` with hash-anchored refs from read output. This matches the approach used by [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent), which successfully steers LLMs toward hash-anchored edits by removing the native fallback path.

## Changes

### Created
- **`.opencode/tools/edit.ts`** -- Custom edit tool with hashline-native schema (`filePath`, `fileRev?`, `operations[]`). Calls `runHashlineOperationsDetailed` with `dryRun: false` to apply edits directly. Includes a concise tool description with workflow, rules, operation types, examples, and error recovery.

### Modified
- **`.opencode/plugins/hashline-hooks.ts`** -- Removed ~190 lines of dead code:
  - Removed the `tool.definition` hook's edit schema extension block
  - Removed `translateHashlineEditArgs` and all supporting functions (`hasHashlineEditShape`, `toHashlineOperations`, `firstString`, `firstBoolean`, `isNativeEditTool`)
  - Simplified `tool.execute.before` to only strip hashline prefixes from content fields (write, patch, apply_patch still need this)
  - Cleaned up unused imports (`mapOperationInput`, `runHashlineOperationsDetailed`, `HashlineOperationInput`)
- **`.opencode/plugins/hashline-routing.ts`** -- Removed `"edit"` from the known-tools set and removed all edit-specific snake_case-to-camelCase arg normalization (the custom tool defines its own schema)
- **`test/hashline-hardening.test.mjs`** -- Updated tests to verify the hook no longer modifies the edit tool's schema or description

### Removed
- **`.opencode/tools/resolve-hash-edit.ts`** -- Deleted (backup in `tools_disabled/`). This MCP tool was a workaround that translated hashline operations to `oldString`/`newString` in a separate tool call. Redundant now that the edit tool handles hashline operations directly.

## What stays the same

- **Read tool** -- Still uses the `tool.execute.after` hook to annotate output with `#HL` refs. Not replaced.
- **Write/patch/apply_patch tools** -- Still native, still get hashline prefix stripping via `tool.execute.before`
- **System prompt injection** -- `experimental.chat.system.transform` hook still injects hashline workflow guidance
- **hashline-core.ts** -- Core engine unchanged
- **Ref format** -- Still `LINE#HASH#ANCHOR` (3-4 hex chars), more collision-resistant than alternatives

## How to verify

See `specs/verify-hashline-edit-schema.md` for the full test procedure. Quick version:

1. Start a new OpenCode session
2. Ask the LLM to read a file, then edit it
3. Export the session and inspect edit tool calls:

```bash
opencode export <sessionID> > session.json
node -e "
const d = require('./session.json');
for (const m of d.messages) {
  for (const p of (m.parts || [])) {
    if (p.type === 'tool' && p.tool === 'edit') {
      const input = p.state?.input || {};
      const style = 'operations' in input ? 'HASHLINE' : 'NATIVE';
      console.log(style, Object.keys(input));
    }
  }
}
"
```

All edit calls should print `HASHLINE`.
