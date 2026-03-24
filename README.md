# Hashline toolset for OpenCode

[![CI](https://github.com/AngDrew/opencode-hashline/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/AngDrew/opencode-hashline/actions/workflows/ci.yml)
[![Publish to npm](https://github.com/AngDrew/opencode-hashline/actions/workflows/publish.yml/badge.svg)](https://github.com/AngDrew/opencode-hashline/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/%40angdrew/opencode-hashline-plugin?logo=npm)](https://www.npmjs.com/package/%40angdrew/opencode-hashline-plugin)
[![npm downloads](https://img.shields.io/npm/dm/%40angdrew/opencode-hashline-plugin?logo=npm)](https://www.npmjs.com/package/%40angdrew/opencode-hashline-plugin)
[![npm license](https://img.shields.io/npm/l/%40angdrew/opencode-hashline-plugin)](https://www.npmjs.com/package/%40angdrew/opencode-hashline-plugin)

This repository provides hashline annotation and translation support for OpenCode's native file tools. It keeps OpenCode's built-in `read`, `edit`, and `write` tools in place, then uses hooks to annotate reads with stable line references and translate edits back into native file operations.

It is both:
- a publishable OpenCode plugin package (`@angdrew/opencode-hashline-plugin`), and
- a local `.opencode/` runtime implementation of tools/plugins.

## What it replaces

This project no longer replaces built-in OpenCode tools.

Instead, it layers two responsibilities on top of the native file workflow:

- annotation: add stable hashline refs to `read` output
- translation: convert hashline-based `edit` requests into native file mutations

The canonical path is therefore built around OpenCode's native `read`, `edit`, and `write` tools, not tool-name overrides.

## Tools provided

- `read`: native output annotated with hashline refs (`<prefix>REV:...` + `<prefix><line>#<hash>#<anchor>|...`; default prefix is `#HL`)
- `edit`: accepts hashline refs and is translated by hooks into native file edits
- `write`: native full-file replacement remains available for direct file writes
- `resolve-hash-edit`: deprecated internal helper for compatibility only; do not grant it in new agent configs

## Files

### Package entrypoint
- `src/index.ts` — exports plugin wiring for routing + hook integration

### OpenCode runtime implementation
- `.opencode/lib/hashline-core.ts` — hashing, parsing, ref validation, file I/O, and operation helpers
- `.opencode/plugins/hashline-routing.ts` — routing glue for the native tool workflow
- `.opencode/plugins/hashline-hooks.ts` — read annotation, edit translation, minimal system-instruction injection, and chat file-part annotation
- `.opencode/plugins/hashline-shared.ts` — shared config, formatting, cache, exclusion handling, and runtime helpers
- `.opencode/tools/resolve-hash-edit.ts` — deprecated internal helper retained for compatibility only
- `opencode.json` — repo-root OpenCode config that registers the routing plugin and includes the minimal `hashline-test` agent

## Read output contract

`read` returns text in this shape:

```text
<hashline-file path="..." file_hash="..." total_lines="..." start_line="..." shown_until="...">
# format: <line>#<hash>#<anchor>|<content>
#HLREV:72C4946C
#HL12#A3F#1B2|const x = 1
#HL13#9BC#3D4|return x
</hashline-file>
```

References remain valid while referenced line content is unchanged.

The default prefix is `#HL`. If you customize it, keep the same prefix in your project configuration and any prompt examples.

## Edit operation contract

Canonical workflow:

1. `read` the file to obtain hashline refs
2. `edit` using those refs so hooks can translate the request into native file changes
3. `read` again to confirm the result and refresh refs

Batch `edit` mode:

```json
{
  "filePath": "src/example.ts",
  "expectedFileHash": "AB12CD34EF",
  "fileRev": "72C4946C",
  "operations": [
    { "op": "replace", "startRef": "#HL13#9BC#3D4", "content": "return x + 1" },
    { "op": "insert_after", "startRef": "#HL12#A3F#1B2", "content": "console.log(x)" }
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
  "startRef": "#HL12#A3F#1B2",
  "endRef": "#HL13#9BC#3D4",
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

## Helper resolver

The hashline resolver helper is deprecated and internal only.

- It is kept for compatibility with older experiments and internal flows
- It should not be treated as part of the public architecture
- New agent configs should not grant it permissions

## Configuration (`opencode-hashline.json`)

Runtime behavior can be configured with JSON:

- Global: `~/.config/opencode/opencode-hashline.json`
- Project: `<project>/opencode-hashline.json`

Supported keys:

- `exclude` (`string[]`) — glob patterns to skip annotation/edit access checks
- `maxFileSize` (`number`) — max bytes; `0` disables size limit
- `cacheSize` (`number`) — annotation cache entry count
- `prefix` (`string | false`) — default `"#HL"`; set `false` for no prefix
- `fileRev` (`boolean`) — include `<prefix>REV:<hash>` in annotated output
- `safeReapply` (`boolean`) — default behavior for `edit` safe-reapply handling

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

### Recommended smoke-test agent

The `hashline-test` agent in `opencode.json` is intentionally minimal for the canonical workflow:

- allow only `read`, `edit`, and `write`
- keep permissions narrow so the sample exercises the native file workflow only
- deny `bash`, `glob`, `grep`, and `list` so the agent stays deterministic and file-local
- do not grant any resolver helper in this sample agent
- the agent config mirrors the simplified permissions model used by the refactored architecture

## Safety model

- Line refs use adaptive hash length (3 chars for files <= 4096 lines, 4 chars otherwise).
- Optional `expectedFileHash` and `fileRev` reject stale edits when file contents changed.
- Overlapping operations in one request are rejected.
- Config sanitization applies validation and safe bounds to runtime-config values.
- System instruction injection is minimal and idempotent, so repeated hook application does not duplicate policy text.

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

- Local Node sanity checks can fail if `@opencode-ai/plugin` is not installed in the directory. The runtime hook files are intended for OpenCode execution.
- Core module (`hashline-core.ts`) can be imported standalone for logic validation.
