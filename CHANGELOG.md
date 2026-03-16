# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-03-17

### Changed

- Reverted the primary tool surface to built-in names (`read`, `edit`, `patch`, `write`) while keeping `hash-check` as the custom preflight tool so OpenCode shows native diff UI behavior.
- Updated routing, permissions, docs, smoke tests, and regression coverage to follow the built-in-surface naming and keep hashline semantics behind the same tool names as native.
- Clarified across docs and test fixtures that the renamed `patch` tool still expects hashline JSON operations in `patchText`, not unified diff input.
- Removed default-exported `hash-read`, `hash-edit`, `hash-patch`, and `hash-write` tool modules so runtime discovery exposes only built-in-surface `read`, `edit`, `patch`, and `write` (plus `hash-check`).
## [1.2.0] - 2026-03-16

### Added

- Added `hash-check` as a lightweight preflight tool for validating refs, `fileRev`, and `expectedFileHash` before writing.
- Added benchmark harness files under `bench/` plus `npm run bench` and `npm run bench:legacy` scripts.
- Added regression coverage for diff previews, metadata emission, and `hash-check` validation.

### Changed

- Updated README, codemaps, and package scripts to document benchmarking and the expanded hashline workflow.
- Hashline operations now emit structured diff metadata in addition to inline diff previews for compatible OpenCode surfaces.

### Fixed

- `hash-edit`, `hash-patch`, and `hash-write` now return diff previews directly in tool output.
- Legacy edit formatting now includes diff previews for full-file and string-replace operations.

## [1.1.2] - 2026-03-14

### Fixed

- Resolved `hash-edit` compatibility failure for `replace` when clients send both `ref` and `startRef/endRef` with equivalent targets.
- Normalized ref-range resolution to accept equivalent duplicate refs while still rejecting conflicting dual-target payloads.

### Added

- Added regression coverage for equivalent `ref` + `startRef/endRef` replace payloads.

## [1.1.1] - 2026-03-14

### Changed

- Clarified hashline system instructions to prefer `operations[]` and omit unused fields instead of sending empty strings.
- Added hardening regression coverage for mixed payload handling and `fileRev` compatibility behavior.

### Fixed

- Hardened `hash-edit` single-operation validation with actionable errors for empty/malformed refs and missing replacement/content.
- Improved routing alias normalization so empty canonical fields no longer block non-empty snake_case fallback values.
- Added `fileRev` compatibility handling to accept either the canonical 8-char `#HL REV` token or the 10-char `file_hash` token when models send the wrong field.

## [1.1.0] - 2026-03-14

### Changed

- Renamed tool registrations to distinct hashline names: `hash-read`, `hash-edit`, `hash-patch`, and `hash-write`.
- Updated plugin wiring, routing normalization, system instructions, docs, config, and codemaps to consistently use the `hash-*` tool surface.

### Fixed

- Fixed `tool.execute.before` argument normalization to mutate args in place for OpenCode compatibility.

### Removed

- Removed legacy built-in-name tool entry files: `.opencode/tools/read.ts`, `.opencode/tools/edit.ts`, `.opencode/tools/patch.ts`, and `.opencode/tools/write.ts`.

## [1.0.3] - 2026-03-12

### Added

- Added dynamic README badges for CI status, npm publish status, npm version, monthly downloads, and license.

### Changed

- Improved release visibility in README with live project health indicators.

## [1.0.2] - 2026-03-12

### Added

- Added package metadata links (`repository`, `homepage`, `bugs`) required for npm provenance publishing.
- Added explicit npm auth validation step (`npm whoami`) in publish workflow for clearer release failures.

### Fixed

- Fixed npm release pipeline reliability for tag-driven GitHub Actions publish.

## [1.0.1] - 2026-03-12

### Added

- Added automated npm publish workflow (`.github/workflows/publish.yml`) triggered by `v*` tags.
- Added release-time version/tag validation before publishing to npm.

### Changed

- Updated release documentation for tag-driven npm deployment.
- Added `publishConfig.access = "public"` to package metadata.

## [1.0.0] - 2026-03-12

### Changed

- Standardized canonical tool argument names to camelCase across `read`, `edit`, `patch`, and `write` (`filePath`, `patchText`, `expectedFileHash`, `fileRev`, `dryRun`, `safeReapply`, `startRef`, `endRef`).
- Updated routing normalization to map legacy snake_case inputs to camelCase for backward compatibility while keeping camelCase as canonical.
- Updated README and benchmark examples to use camelCase argument names consistently.

### Removed

- Removed snake_case top-level argument fields from tool schemas.

## [0.3.0] - 2026-03-11

### Changed

- Merged `hashline_edit` capability into `edit` via single-operation mode (`operation` + `startRef`, optional `endRef`, `safeReapply`).
- Updated docs, routing normalization, and benchmark coverage to align with the unified `edit` interface.

### Removed

- Removed legacy `old_string` / `new_string` edit mode.
- Removed standalone `hashline_edit` tool registration and implementation.

## [0.2.1] - 2026-03-11

### Fixed

- Corrected ESM import resolution in `hashline-shared` to use `../tools/hashline-core.js`.
- Re-exported `computeFileRev` from `hashline-shared` for consistent shared utility access.
## [0.2.0] - 2026-03-11

### Added

- Rich hashline plugin hooks for read annotation, edit-strip, system prompt transform, and chat file-part annotation handling.
- Structured hashline edit diagnostics with explicit codes (`HASH_MISMATCH`, `FILE_REV_MISMATCH`, `AMBIGUOUS_REAPPLY`, `TARGET_OUT_OF_RANGE`, `INVALID_REF`, `INVALID_RANGE`, `MISSING_REPLACEMENT`).
- Runtime hashline configuration loading from global/project config with cache, exclude patterns, max file size, prefix, `fileRev`, and `safeReapply` options.

### Changed

- Routing plugin now integrates shared hashline hooks and runtime configuration.
