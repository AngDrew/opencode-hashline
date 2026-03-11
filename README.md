# Hashline toolset for OpenCode

[![CI](https://github.com/AngDrew/opencode-hashline/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/AngDrew/opencode-hashline/actions/workflows/ci.yml)
[![Publish to npm](https://github.com/AngDrew/opencode-hashline/actions/workflows/publish.yml/badge.svg)](https://github.com/AngDrew/opencode-hashline/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/%40angdrew/opencode-hashline-plugin?logo=npm)](https://www.npmjs.com/package/%40angdrew/opencode-hashline-plugin)
[![npm downloads](https://img.shields.io/npm/dm/%40angdrew/opencode-hashline-plugin?logo=npm)](https://www.npmjs.com/package/%40angdrew/opencode-hashline-plugin)
[![npm license](https://img.shields.io/npm/l/%40angdrew/opencode-hashline-plugin)](https://www.npmjs.com/package/%40angdrew/opencode-hashline-plugin)

This repository provides hashline-based OpenCode tool overrides for stable, line-referenced file reads and edits.

It is both:
- a publishable OpenCode plugin package (`@angdrew/opencode-hashline-plugin`), and
- a local `.opencode/` runtime implementation of tools/plugins.

## What it replaces

Drop-in overrides are provided for built-in tool names:

- `read` (and `view` normalized to `read` via plugin)
- `edit`
- `patch`
- `write`

OpenCode loads tools from `.opencode/tools/` and allows collisions with built-in names; custom tools take precedence according to OpenCode runtime ordering.

## Tools provided

- `read`: returns hash-annotated output (`<prefix>REV:...` + `<prefix><line>#<hash>#<anchor>|...`; default prefix is `;;;`)
- `edit`: supports both `operations[]` batch mode and single-operation mode (`operation` + `startRef`, optional `endRef`, `safeReapply`)
- `patch`: accepts `patchText` as JSON payload (array of ops or object with file+ops)
- `write`: full-file replacement through `set_file`

## Files

### Package entrypoint
- `src/index.ts` — exports plugin wiring for routing + tool overrides

### OpenCode runtime implementation
- `.opencode/tools/hashline-core.ts` — hashing, parsing, ref validation, file I/O, operation engine
- `.opencode/tools/read.ts` — hashline reader
- `.opencode/tools/edit.ts` — hashline operations (batch + single-operation modes)
- `.opencode/tools/patch.ts` — patch bridge using JSON operation payloads
- `.opencode/tools/write.ts` — full file replace through `set_file`

- `.opencode/plugins/hashline-routing.ts` — tool alias + argument normalization (`view -> read`)
- `.opencode/plugins/hashline-hooks.ts` — read annotation, edit arg normalization/stripping, system instruction injection, chat file-part annotation
- `.opencode/plugins/hashline-shared.ts` — shared config, formatting, cache, exclusion handling, runtime helpers
- `opencode.json` — registers plugin `hashline-routing` and includes sample `hashline-test` agent

## Read output contract

`read` returns text in this shape:

```text
<hashline-file path="..." file_hash="..." total_lines="..." start_line="..." shown_until="...">
# format: <line>#<hash>#<anchor>|<content>
;;;REV:72C4946C
;;;12#A3F#1B2|const x = 1
;;;13#9BC#3D4|return x
</hashline-file>
```

References remain valid while referenced line content is unchanged.

## Edit operation contract

Batch `edit` mode:

```json
{
  "filePath": "src/example.ts",
  "expectedFileHash": "AB12CD34EF",
  "fileRev": "72C4946C",
  "operations": [
    { "op": "replace", "startRef": "13#9BC#3D4", "content": "return x + 1" },
    { "op": "insert_after", "startRef": "12#A3F#1B2", "content": "console.log(x)" }
  ]
}
```

Supported ops:

- `replace`
- `delete`
- `insert_before`
- `insert_after`
- `replace_range` (`startRef` + `endRef`)
- `set_file`

Single-operation `edit` mode:

```json
{
  "filePath": "src/example.ts",
  "operation": "replace",
  "startRef": "12#A3F#1B2",
  "endRef": "13#9BC#3D4",
  "replacement": "const value = 2",
  "fileRev": "72C4946C",
  "safeReapply": true
}
```

Notes:
- `operation` supports: `replace`, `delete`, `insert_before`, `insert_after`
- Use `startRef` as the primary target key
- `endRef` is optional; when present, operations apply across the range
- `replacement` (or `content`) is required for `replace`, `insert_before`, and `insert_after`
- `safeReapply` can be used in both batch and single-operation modes
- Legacy snake_case aliases are accepted only via routing compatibility; they are not canonical.

### Migration notes

- `hashline_edit` has been merged into `edit` single-operation mode.
- Legacy `old_string` / `new_string` in `edit` has been removed.
- Use hashline refs from `read` output and call `edit` with either:
  - `operations[]` (batch), or
  - `operation` + `startRef` (+ optional `endRef`).

## Patch contract

`patch` expects `patchText` as JSON (not unified diff). It supports:

1) an array of operations, or
2) an object with `{ filePath, operations, expectedFileHash, fileRev }`

Example:

```json
{
  "patchText": "{\"filePath\":\"src/example.ts\",\"expectedFileHash\":\"AB12CD34EF\",\"fileRev\":\"72C4946C\",\"operations\":[{\"op\":\"delete\",\"startRef\":\"20#F1A#8BC\"}]}"
}
```

## Configuration (`opencode-hashline.json`)

Runtime behavior can be configured with JSON:

- Global: `~/.config/opencode/opencode-hashline.json`
- Project: `<project>/opencode-hashline.json`

Supported keys:

- `exclude` (`string[]`) — glob patterns to skip annotation/edit access checks
- `maxFileSize` (`number`) — max bytes; `0` disables size limit
- `cacheSize` (`number`) — annotation cache entry count
- `prefix` (`string | false`) — default `";;;"`; set `false` for no prefix
- `fileRev` (`boolean`) — include `<prefix>REV:<hash>` in annotated output
- `safeReapply` (`boolean`) — default behavior for `edit` safe-reapply handling

Default values:

```json
{
  "maxFileSize": 1048576,
  "cacheSize": 100,
  "prefix": ";;;",
  "fileRev": true,
  "safeReapply": false
}
```

## Safety model

- Line refs use adaptive hash length (3 chars for files <= 4096 lines, 4 chars otherwise).
- Optional `expectedFileHash` and `fileRev` reject stale edits when file contents changed.
- Overlapping operations in one request are rejected.
- Config sanitization applies validation and safe bounds to runtime-config values.

## Development

Requirements:
- Node.js 22 (matches CI)

Commands:
- Install: `npm ci`
- Build: `npm run build` (outputs `dist/`, which is gitignored)
- Test: `npm test` (requires built `dist/` artifacts)
- Benchmark: `npm run bench` (requires built `dist/` artifacts)
- Dry-run package contents: `npm run pack:check`

## CI

GitHub Actions workflow (`.github/workflows/ci.yml`) runs install + build + tests on push and pull requests.

## Auto publish to npm

GitHub Actions workflow (`.github/workflows/publish.yml`) publishes to npm automatically when you push a version tag.

Trigger:
- Push tags matching `v*` (for example `v1.0.1`)

Required environment secret (environment: `sikrit`):
- `NPM_TOKEN`: npm access token with publish permissions for `@angdrew/opencode-hashline-plugin`

Release flow:
1. Update `package.json` version to the release version (without `v`, e.g. `1.0.1`)
2. Commit and push changes
3. Create and push tag with `v` prefix:
   - `git tag -a v1.0.1 -m "Release v1.0.1"`
   - `git push origin v1.0.1`

The workflow validates that tag version and `package.json` version match, then runs `npm publish --provenance --access public`.

## Notes

- Local Node sanity checks can fail for tool wrappers if `@opencode-ai/plugin` is not installed in the directory. These wrappers are intended for OpenCode runtime.
- Core module (`hashline-core.ts`) can be imported standalone for logic validation.
