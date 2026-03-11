# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-03-11

### Changed

- Merged `hashline_edit` capability into `edit` via single-operation mode (`operation` + `start_ref`/`ref`, optional `end_ref`, `safe_reapply`).
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
