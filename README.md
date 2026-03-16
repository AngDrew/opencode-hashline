# Hashline for OpenCode

[![CI](https://github.com/AngDrew/opencode-hashline/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/AngDrew/opencode-hashline/actions/workflows/ci.yml)
[![Publish to npm](https://github.com/AngDrew/opencode-hashline/actions/workflows/publish.yml/badge.svg)](https://github.com/AngDrew/opencode-hashline/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/%40angdrew/opencode-hashline-plugin?logo=npm)](https://www.npmjs.com/package/%40angdrew/opencode-hashline-plugin)
[![npm downloads](https://img.shields.io/npm/dm/%40angdrew/opencode-hashline-plugin?logo=npm)](https://www.npmjs.com/package/%40angdrew/opencode-hashline-plugin)
[![npm license](https://img.shields.io/npm/l/%40angdrew/opencode-hashline-plugin)](https://www.npmjs.com/package/%40angdrew/opencode-hashline-plugin)

`@angdrew/opencode-hashline-plugin` adds hashline-aware file tools to OpenCode. It replaces fuzzy, line-number-based edits with stable line references so agents can read, edit, patch, and rewrite files more safely across repeated tool calls.

## What it does

- Exposes `hash-read`, `hash-check`, `hash-edit`, `hash-patch`, and `hash-write` as distinct OpenCode tools.
- Returns stable line refs and a file revision marker instead of relying on raw line numbers.
- Lets callers preflight refs and concurrency guards with `hash-check` before spending tokens on full edits.
- Applies edits against exact refs, which helps prevent stale or ambiguous changes.
- Adds inline diff previews and structured diff metadata for edit, patch, and write results.

## Install

Install the package in the workspace where OpenCode runs:

```bash
npm install -D @angdrew/opencode-hashline-plugin
```

Add the plugin to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@angdrew/opencode-hashline-plugin"]
}
```

If you use per-agent permissions, allow the hashline tools explicitly:

```json
{
  "agent": {
    "hashline": {
      "permission": {
        "hash-read": "allow",
        "hash-check": "allow",
        "hash-edit": "allow",
        "hash-patch": "allow",
        "hash-write": "allow"
      }
    }
  }
}
```

## How it works

1. `hash-read` returns annotated lines in the form `<line>#<hash>#<anchor>|<content>` and includes a `REV:<hash>` marker for the current file revision.
2. `hash-check` can validate refs, `fileRev`, and `expectedFileHash` before a write.
3. `hash-edit` and `hash-patch` target those refs, while `hash-write` replaces the full file when a rewrite is simpler.
4. `fileRev` and `expectedFileHash` can reject stale writes when the file changed after the last read.
5. `hash-edit`, `hash-patch`, and `hash-write` return inline diff previews and structured diff metadata.
6. After every successful edit, read the file again before sending more refs.

Example `hash-read` output:

```text
const x = 1
return x
```

Typical flow:

```text
hash-read -> capture refs + fileRev -> optional hash-check -> hash-edit/hash-patch/hash-write -> hash-read again
```

## Tools

| Tool | Use it for | Notes |
| --- | --- | --- |
| `hash-read` | Read a file and collect stable refs | Output is hash-annotated; default prefix is `;;;` |
| `hash-check` | Preflight refs and concurrency guards | Validates `fileRev`, `expectedFileHash`, and targets without writing |
| `hash-edit` | Apply targeted edits against refs | Supports `operations[]` batch mode and single-operation mode |
| `hash-patch` | Send a JSON patch payload | Uses the same operation engine as `hash-edit`; not a unified diff tool |
| `hash-write` | Replace an entire file | Best when a full rewrite is simpler than incremental edits |

Common edit operations:

- `replace`
- `delete`
- `insert_before`
- `insert_after`
- `replace_range`
- `set_file`

## Example edit payload

```json
{
  "filePath": "src/app.ts",
  "fileRev": "72C4946C",
  "operations": [
    { "op": "replace", "ref": "12#A3F#1B2", "content": "const value = 2" },
    { "op": "insert_after", "ref": "12#A3F#1B2", "content": "console.log(value)" }
  ]
}
```

## Example preflight check payload

```json
{
  "filePath": "src/app.ts",
  "fileRev": "72C4946C",
  "expectedFileHash": "A1B2C3D4E5",
  "targets": [
    { "op": "replace", "ref": "12#A3F#1B2" }
  ]
}
```

## Benchmarking

Use the benchmark harness in `bench/`:

```bash
npm run bench
```

Optional overrides:

- `BENCH_WARMUP` (default from `bench/cases.json`: `20`)
- `BENCH_ITERATIONS` (default from `bench/cases.json`: `120`)

`bench/cases.json` controls:

- performance matrix (`sizes`, `operations`)
- correctness scenarios and expected outcomes
- gate thresholds (`correctnessPassRate`, `wrongToolRate`, `maxP95RegressionPercent`)

For comparison with the previous benchmark script:

```bash
npm run bench:legacy
```

## Repository layout

- `src/index.ts` - plugin entrypoint that registers the tool handlers.
- `.opencode/tools/` - hashline tool implementations.
- `.opencode/plugins/` - routing and compatibility hooks used by the plugin.
- `bench/` - benchmark harness (`runner.mjs`) and scenario matrix (`cases.json`).
- `scripts/benchmark.mjs` - previous benchmark runner retained as `npm run bench:legacy`.

## Contributing

```bash
npm ci
npm run build
npm test
npm run bench
npm run bench:legacy
npm run pack:check
```

- Open an issue or PR if you find a stale-ref edge case, routing bug, or tool contract gap.
- Keep changes focused and update docs or tests when behavior changes.
- CI runs on Node.js 22.

## License

MIT
