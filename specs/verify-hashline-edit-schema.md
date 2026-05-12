# Verify: Custom Edit Tool Uses Hashline Args

The built-in `edit` tool has been replaced by a custom tool (`.opencode/tools/edit.ts`) that **only** accepts hashline-style args (`filePath`, `fileRev`, `operations[]`). There is no `oldString`/`newString` path. This spec verifies the custom tool works end-to-end in a new session.

## Background

The hashline plugin now works as follows:

1. **Read**: `tool.execute.after` hook annotates output with `#HL` refs and a `REV:` token (unchanged).
2. **Edit**: A custom tool registered as `edit` in `.opencode/tools/edit.ts` replaces the built-in. It accepts only `{ filePath, fileRev?, operations[] }` and calls `runHashlineOperationsDetailed` directly. No `oldString`/`newString` schema exists.

The old approach (extending the native edit schema via `tool.definition` hook) was removed because the schema extension never reached the LLM -- confirmed by session export inspection.

## What to verify

1. The LLM's edit calls contain `operations` (not `oldString`/`newString`).
2. The edit executes successfully and the file is modified.
3. Hash mismatch errors are reported clearly when refs are stale.

## Test procedure

### 1. Create a test file

Create `testdata/verify-edit.txt` with content:

```
alpha
bravo
charlie
delta
echo
foxtrot
```

### 2. Read the file

Ask the LLM to read `testdata/verify-edit.txt`. The output should include `#HL` refs:

```
#HL REV:XXXXXXXX
#HL 1#XXX#XXX|alpha
#HL 2#XXX#XXX|bravo
...
```

Confirm the refs and REV token are present.

### 3. Edit using hashline refs

Ask the LLM to replace the line `bravo` with `bravo-replaced`. Since the edit tool only accepts hashline args, the LLM must send something like:

```json
{
  "filePath": "testdata/verify-edit.txt",
  "fileRev": "<REV from read>",
  "operations": [
    { "op": "replace", "ref": "<ref for bravo>", "content": "bravo-replaced" }
  ]
}
```

This should execute successfully.

### 4. Verify the edit worked

Read the file again. Confirm `bravo` was replaced with `bravo-replaced`.

### 5. Test a second edit (re-read required)

Ask the LLM to also replace `delta` with `delta-modified`. The LLM should re-read (since refs are stale after the first edit), get fresh refs, and submit a new edit call.

## How to inspect raw LLM tool call args

### Option A: Export the session (after the fact)

```bash
# List sessions to find the ID
opencode session list --format json

# Export the session
opencode export <sessionID> > session.json

# Inspect edit tool calls
node -e "
const d = require('./session.json');
let editNum = 0;
for (const m of d.messages) {
  for (const p of (m.parts || [])) {
    if (p.type === 'tool' && p.tool === 'edit') {
      editNum++;
      const input = p.state?.input || {};
      const hasOps = 'operations' in input;
      const hasOld = 'oldString' in input;
      const style = hasOps ? 'HASHLINE' : (hasOld ? 'NATIVE (BAD)' : 'UNKNOWN');
      console.log('Edit #' + editNum + ': ' + style);
      console.log('  Keys:', Object.keys(input));
      console.log('  Input:', JSON.stringify(input).slice(0, 400));
      console.log();
    }
  }
}
console.log('Total edit calls:', editNum);
"
```

Every edit call should print `HASHLINE`. If any prints `NATIVE (BAD)`, the custom tool is not being used.

### Option B: Use `opencode run --format json`

```bash
opencode run --format json \
  "Read testdata/verify-edit.txt, then replace 'bravo' with 'bravo-modified'" \
  2>&1 | node -e "
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', line => {
  try {
    const e = JSON.parse(line);
    if (e.type === 'tool' || (e.properties?.tool === 'edit')) {
      console.log(JSON.stringify(e, null, 2));
    }
  } catch {}
});
"
```

### Option C: Share the session

Type `/share` in the TUI after the edit. The shared session URL shows tool call arguments.

## Expected results

- **All** edit calls must use hashline-style args (`operations` + optional `fileRev`). There is no `oldString`/`newString` fallback in the custom tool schema.
- If the edit tool is called but fails with a schema validation error mentioning `oldString` or `newString`, it means the custom tool did NOT replace the built-in. Check that `.opencode/tools/edit.ts` exists and exports a default tool.
- If the edit tool receives `operations` but the edit fails with a hash mismatch, the LLM used stale refs. This is expected behavior -- the error message should guide re-reading.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Edit calls still show `oldString`/`newString` | Custom tool not loaded | Verify `.opencode/tools/edit.ts` exists with `export default tool(...)`. Restart opencode. |
| Schema error on edit call | Custom tool schema mismatch | Check that the tool schema matches what the LLM sends. |
| `resolve-hash-edit` tool still appears | Old MCP tool not removed | Delete `.opencode/tools/resolve-hash-edit.ts` (backup is in `tools_disabled/`). |
| Hash mismatch error | LLM used stale refs after a prior edit | Expected. The LLM should re-read before the next edit. |
| Edit succeeds but no diff shown in TUI | Custom tool output format differs from built-in | The custom tool returns a string like `Updated <path> (+N -N)`. The TUI may not show a diff panel for custom tools. |

## Cleanup

Delete `testdata/verify-edit.txt` after testing if it was created for this purpose.
