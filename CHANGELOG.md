# Changelog

All notable changes to this project will be documented in this file.

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
