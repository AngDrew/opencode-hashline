# Hashline toolset for OpenCode

[![CI](https://github.com/AngDrew/opencode-hashline/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/AngDrew/opencode-hashline/actions/workflows/ci.yml)
[![Publish to npm](https://github.com/AngDrew/opencode-hashline/actions/workflows/publish.yml/badge.svg)](https://github.com/AngDrew/opencode-hashline/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/%40angdrew/opencode-hashline-plugin?logo=npm)](https://www.npmjs.com/package/%40angdrew/opencode-hashline-plugin)
[![npm downloads](https://img.shields.io/npm/dm/%40angdrew/opencode-hashline-plugin?logo=npm)](https://www.npmjs.com/package/%40angdrew/opencode-hashline-plugin)
[![npm license](https://img.shields.io/npm/l/%40angdrew/opencode-hashline-plugin)](https://www.npmjs.com/package/%40angdrew/opencode-hashline-plugin)

This project solves a painful OpenCode problem: file edits become brittle when an LLM only has raw text and line numbers to work with.
Hashline keeps OpenCode on its native read / edit / write path, but adds stable line references to file reads and translates ref-based edits back into native file mutations.

In practice, that means:

- fewer wrong-line edits
- stale context is detected instead of silently applied
- the model can keep using normal OpenCode tools and UI

## Why this matters

LLMs are good at understanding code, but they are bad at remembering exact file positions after the file changes.
Plain line numbers drift, exact text matches can be ambiguous, and an agent can easily edit the wrong place if the file changed between reads.

Hashline fixes that by pairing each line with a short content hash, an anchor hash, and an optional file revision token.
The result is a safer read/edit loop that survives small file changes and rejects stale edits early.

## Install

### Use the published npm package

Add the plugin to your OpenCode config. OpenCode installs npm plugins automatically at startup.

~~~jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@angdrew/opencode-hashline-plugin"]
}
~~~

Place that in either:

- opencode.json in your project root
- ~/.config/opencode/opencode.json for a global setup

### Use this repository locally

If you are working inside this repo, the plugin source already lives under .opencode/plugins/ and is loaded by OpenCode.
The included opencode.json already enables the local hashline-routing plugin plus a minimal smoke-test agent.

## Setup

OpenCode accepts both JSON and JSONC, so the commented template below is safe to copy.

### Copy-paste starter config

Use this as a ready-to-go project config:

~~~jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@angdrew/opencode-hashline-plugin"],
  "agent": {
    "hashline-test": {
      "description": "Minimal smoke-test agent for hashline read/edit/write",
      "mode": "primary",
      "model": "proxy/gpt-5.1-codex-mini",
      "permission": {
        "*": "deny",
        "read": "allow",
        "edit": "allow",
        "write": "allow",
        "bash": "deny",
        "glob": "deny",
        "grep": "deny",
        "list": "deny"
      }
    }
  }
}
~~~

If you only want the plugin, you can omit the agent block.
This sample agent is intentionally narrow so it exercises only the native file workflow.

### Optional runtime config

If you want to tweak annotation and runtime behavior, add opencode-hashline.json:

~~~jsonc
{
  "exclude": ["**/node_modules/**"],
  "maxFileSize": 1048576,
  "cacheSize": 100,
  "prefix": "#HL",
  "fileRev": true,
  "safeReapply": false
}
~~~

Save it in the project root or in your global OpenCode config.

## What it provides

| Surface | Status | What happens |
| --- | --- | --- |
| read / view | public | native reads are annotated with stable #HL refs and a REV line |
| edit | public | hashline refs are translated into native file edits |
| write | public | stays native, with hashline prefixes stripped from nested content fields |
| patch | compatibility | routing and legacy support only; not the recommended path |
| resolve-hash-edit | internal | compatibility and debug helper; do not grant to new agents |

It also adds a small system-instruction hook and annotates file parts that appear in chat messages. The injected guidance is config-aware, keeps the active prefix in sync, and nudges batch-first edits to reduce extra reads.

## How it looks in OpenCode

OpenCode still calls the native tools.
Hashline only changes the data flowing through them.

### 1) Read a file

OpenCode asks the plugin to read a file. The output comes back annotated:

~~~text
<hashline-file path="/workspace/src/example.ts" file_hash="AB12CD34EF" total_lines="2" start_line="1" shown_until="2">
# format: <line>#<hash>#<anchor>|<content>
# use refs exactly as shown in hashline edit/patch tools
#HL REV:72C4946C
#HL 1#A3F#1B2|const x = 1
#HL 2#9BC#3D4|return x
</hashline-file>
~~~

### 2) Edit using the ref

The model sends a normal edit request with the ref copied exactly as shown:

~~~json
{
  "filePath": "src/example.ts",
  "operation": "replace",
  "startRef": "#HL 2#9BC#3D4",
  "replacement": "return x + 1",
  "fileRev": "72C4946C",
  "safeReapply": true
}
~~~

### 3) The hook translates it

Behind the scenes, the plugin turns that into native edit arguments:

~~~json
{
  "filePath": "src/example.ts",
  "oldString": "return x",
  "newString": "return x + 1"
}
~~~

That keeps the OpenCode workflow familiar while making the edit safer and less brittle.

## Why this matters in practice

- no guessing line numbers after the file shifts
- fewer accidental edits when the same text appears multiple times
- stale file state is rejected with fileRev and expectedFileHash
- safeReapply can relocate a line when there is exactly one matching candidate
- the normal OpenCode UI, permissions, and diff flow remain intact

## Project layout

### Package entrypoint
- `src/index.ts` — default package export; loads and returns the routing plugin hooks

### Runtime source of truth
- `.opencode/plugins/hashline-routing.ts` — tool-name normalization, argument normalization, hook composition
- `.opencode/plugins/hashline-hooks.ts` — read annotation, edit translation, cache invalidation, tool-definition hints, system/chat hooks
- `.opencode/plugins/hashline-shared.ts` — runtime config loading, formatting helpers, exclusion handling, annotation cache, prefix stripping
- `.opencode/plugins/hashline-contract.ts` — canonical ref/rev parsing, formatting, and example builders
- `.opencode/lib/hashline-core.ts` — hashing, file reading, ref resolution, edit application, `fileRev` handling, and helper utilities
- `.opencode/tools/resolve-hash-edit.ts` — internal compatibility helper source
- `opencode.json` — repo-local OpenCode config registering the plugin and a minimal smoke-test agent

### Tests and generated output
- `test/hashline-hardening.test.mjs` — current hardening/regression test entry used by `npm test`
- `.opencode/tests/` — additional source-level tests kept in the repository
- `dist/` — generated build output for `src/`, `.opencode/lib/`, and `.opencode/plugins/` (gitignored)

## Read output contract

Native `read` output is annotated into this shape:

```text
<hashline-file path="/workspace/src/example.ts" file_hash="AB12CD34EF" total_lines="2" start_line="1" shown_until="2">
# format: <line>#<hash>#<anchor>|<content>
# use refs exactly as shown in hashline edit/patch tools
#HL REV:72C4946C
#HL 1#A3F#1B2|const x = 1
#HL 2#9BC#3D4|return x
</hashline-file>
```

Notes:

- refs stay valid while the referenced line content remains unchanged
- `file_hash` is the full-file hash used for optional stale-write checks
- `REV` is the 8-character normalized revision token used by `fileRev`
- when `offset` / `limit` omit lines, the output may also include `# skipped lines: ...` and `# truncated: ...` comments
- the canonical read contract uses the `#HL` prefix

## Native `edit` with hashline refs

The plugin accepts hashline refs on native `edit` and translates them into a native edit payload internally.

### Batch mode

```json
{
  "filePath": "src/example.ts",
  "expectedFileHash": "AB12CD34EF",
  "fileRev": "72C4946C",
  "operations": [
    {
      "op": "replace",
      "startRef": "#HL 2#9BC#3D4",
      "content": "return x + 1"
    },
    {
      "op": "insert_before",
      "startRef": "#HL 1#A3F#1B2",
      "content": "console.log(x)"
    }
  ]
}
```

Supported batch ops:

- `replace`
- `delete`
- `insert_before`
- `insert_after`
- `replace_range`
- `set_file`

### Single-operation mode

```json
{
  "filePath": "src/example.ts",
  "operation": "replace",
  "startRef": "#HL 2#9BC#3D4",
  "replacement": "return x + 1",
  "fileRev": "72C4946C",
  "safeReapply": true
}
```

Single-operation notes:

- `operation` supports `replace`, `delete`, `insert_before`, and `insert_after`
- `ref` is accepted; `startRef` is the clearer canonical field when targeting a line or range
- `endRef` is optional and can be used for ranged operations
- `replacement` or `content` is required for `replace`, `insert_before`, and `insert_after`
- `safeReapply` allows ref relocation when hashes still match but line numbers have moved
- `expectedFileHash` and `fileRev` reject stale edits after file contents change
- after any successful edit, read the file again before reusing refs

## Helper resolver

`resolve-hash-edit` is **not** the main public interface.

It is kept only as compatibility/debugging source in this repo and should not be granted in new agent configs when the normal native `read` -> `edit` flow is available.

## Configuration (`opencode-hashline.json`)

Runtime config can be loaded from:

- global: `~/.config/opencode/opencode-hashline.json`
- project: `<project>/opencode-hashline.json`

Supported keys:

- `exclude` (`string[]`) — glob patterns excluded from annotation/access handling
- `maxFileSize` (`number`) — max annotated output size in bytes; `0` disables the limit
- `cacheSize` (`number`) — annotation cache entry count
- `prefix` (`string | false`) — shared formatting/prefix-stripping setting
- `fileRev` (`boolean`) — shared formatting toggle for REV emission in helper formatters
- `safeReapply` (`boolean`) — default behavior for ref relocation during edit translation

Default values:

```json
{
  "maxFileSize": 1048576,
  "cacheSize": 100,
  "prefix": "#HL",
  "fileRev": true,
  "safeReapply": false
}
```

Important: the current native `read` hook emits the canonical `#HL` + `REV` contract via `runHashlineRead(...)`. Treat `prefix` and `fileRev` as lower-level runtime/helper settings, not as a promise that native `read` output will change to an arbitrary custom format.

## Sample smoke-test agent

The `hashline-test` agent in `opencode.json` intentionally stays narrow:

- allow only `read`, `edit`, and `write`
- deny `bash`, `glob`, `grep`, and `list`
- omit `patch` from the sample flow
- do not grant the resolver helper

That keeps the example aligned with the supported native-tool workflow.

## Safety model

- refs use adaptive hash length: 3 characters for files with up to 4096 lines, 4 characters above that
- optional `expectedFileHash` and `fileRev` checks reject stale edits
- overlapping edits in one request are rejected
- `safeReapply` can relocate a ref when there is exactly one matching candidate after lines have moved
- config loading sanitizes values and applies safe bounds
- system-instruction injection is idempotent so repeated hook application does not duplicate guidance

## Development

Requirements:

- Node.js 22

Commands:

- install: `npm ci`
- build: `npm run build`
- test: `npm test`
- inspect package contents: `npm run pack:check`

`dist/` is generated build output and is gitignored.

## CI

GitHub Actions workflow `.github/workflows/ci.yml` runs install, build, and test on **pull requests** across:

- ubuntu-latest
- windows-latest
- macos-latest

## Auto publish to npm

GitHub Actions workflow `.github/workflows/publish.yml` is intended to publish automatically when you push a version tag.

Trigger:

- push tags matching `v*` (for example `v1.0.1`)

Required environment secret (environment: `sikrit`):

- `NPM_TOKEN` — npm access token with publish permissions for `@angdrew/opencode-hashline-plugin`

Release flow:

1. update `package.json` version to the release version without the `v` prefix
2. commit and push changes
3. create and push a tag with the `v` prefix:
   - `git tag -a v1.0.1 -m "Release v1.0.1"`
   - `git push origin v1.0.1`

The workflow verifies that the tag version matches `package.json`, then runs:

```bash
npm publish --provenance --access public
```

## Notes

- the package's source of truth is the hook-based implementation under `src/`, `.opencode/plugins/`, and `.opencode/lib/`
- local sanity checks that depend on OpenCode runtime behavior may still require `@opencode-ai/plugin` to be installed
- core helpers in `.opencode/lib/hashline-core.ts` can be imported directly for lower-level logic validation
