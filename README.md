# Hashline toolset for OpenCode

This project provides custom OpenCode tools that replace default file mutation behavior with hashline-based line references.

## What it replaces

Drop-in overrides are provided for built-in tool names:

- `read` (and `view` normalized to `read` via plugin)
- `edit`
- `patch`
- `write`

OpenCode loads tools from `.opencode/tools/` and allows collisions with built-in names; custom tools take precedence according to OpenCode runtime ordering.

## Files

- `.opencode/tools/hashline-core.ts` — hashing, parsing, ref validation, file IO, operation engine
- `.opencode/tools/read.ts` — hashline reader output (`<line>#<hash>|<content>`)
- `.opencode/tools/edit.ts` — hashline operation edits + legacy old/new fallback
- `.opencode/tools/patch.ts` — patch bridge using JSON operation payloads
- `.opencode/tools/write.ts` — full file replace through `set_file`
- `.opencode/plugins/hashline-routing.ts` — alias + arg normalization (`view` -> `read`, camelCase -> snake_case)
- `opencode.json` — registers plugin `hashline-routing`

## Read output contract

`read` returns text in this shape:

```text
<hashline-file path="..." file_hash="..." total_lines="..." start_line="..." shown_until="...">
# format: <line>#<hash>|<content>
12#A3F1|const x = 1
13#9BC0|return x
</hashline-file>
```

References are stable as long as line content remains unchanged.

## Edit operation contract

Preferred `edit` mode:

```json
{
  "file_path": "src/example.ts",
  "expected_file_hash": "AB12CD34EF",
  "operations": [
    { "op": "replace", "ref": "13#9BC0", "content": "return x + 1" },
    { "op": "insert_after", "ref": "12#A3F1", "content": "console.log(x)" }
  ]
}
```

Supported ops:

- `replace`
- `delete`
- `insert_before`
- `insert_after`
- `replace_range` (`start_ref` + `end_ref`)
- `set_file`

Legacy mode remains available through `old_string` and `new_string`.

## Patch contract

`patch` expects `patch_text` as JSON (not unified diff). Either:

1) array of operations
2) object with `{ file_path, operations, expected_file_hash }`

Example:

```json
{
  "patch_text": "{\"file_path\":\"src/example.ts\",\"expected_file_hash\":\"AB12CD34EF\",\"operations\":[{\"op\":\"delete\",\"ref\":\"20#F1A0\"}]}"
}
```

## Safety model

- Each ref includes line number + content hash; mismatches fail fast.
- Optional `expected_file_hash` rejects stale edits if file changed after read.
- Overlapping operations in one request are rejected.

## Notes

- Local Node sanity checks can fail for tool wrappers if `@opencode-ai/plugin` is not installed in the directory. These wrappers are intended for OpenCode runtime.
- Core module (`hashline-core.ts`) can be imported standalone for logic validation.
