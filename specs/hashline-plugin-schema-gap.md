# Hashline Plugin Schema Gap

The `@angdrew/opencode-hashline-plugin` adds stable line-referenced editing to OpenCode. It works by hooking into the native `read`/`edit` tool pipeline: reads are annotated with `#HL` refs, and edit calls containing hashline args are translated into native `oldString`/`newString` before execution.

## Problem

The plugin's `tool.definition` hook only appends a text hint to the Edit tool's description. It does not modify the tool's JSON Schema (the `parameters` object). The declared schema still only accepts `filePath`, `oldString`, `newString`, and `replaceAll`.

The hashline edit args (`operations`, `startRef`, `endRef`, `fileRev`, `safeReapply`, etc.) are undeclared. If OpenCode validates tool call arguments against the JSON Schema before the `tool.execute.before` hook runs, calls using hashline-style args are rejected and the translation hook never fires.

### Relevant code

In `.opencode/plugins/hashline-hooks.ts`, the `tool.definition` hook:

```typescript
"tool.definition": async (input, output) => {
  if (input.toolID === "edit") {
    output.description = `${output.description}\n\nHashline: Accepts refs copied from read...`
  }
}
```

Only `output.description` is modified. `output.parameters` (or equivalent schema field) is never touched.

The `tool.execute.before` hook does the actual translation:

```typescript
"tool.execute.before": async (input, output) => {
  if (isNativeEditTool(name)) {
    const translatedArgs = await translateHashlineEditArgs(sanitizedArgs, input, config)
    if (translatedArgs) {
      output.args = translatedArgs // { filePath, oldString, newString }
      return
    }
  }
}
```

This converts hashline args into native args, but only runs after schema validation has already passed.

### Result

- Read annotations work (the `tool.execute.after` hook transforms output, no schema issue).
- Edit translation is effectively unreachable when OpenCode enforces strict schema validation on tool inputs.
- The LLM sees the description hint but cannot act on it because the schema rejects the args.

## Fix

The `tool.definition` hook should extend the Edit tool's parameter schema to include the hashline fields (`operations`, `operation`, `startRef`, `endRef`, `ref`, `fileRev`, `expectedFileHash`, `safeReapply`, `replacement`, `content`) and relax `required` so that either `oldString`/`newString` or hashline-style args are accepted. This would let the args pass schema validation and reach the `tool.execute.before` translation hook.
