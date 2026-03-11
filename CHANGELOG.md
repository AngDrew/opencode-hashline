# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-03-11

### Added

- Rich hashline plugin hooks for read annotation, edit-strip, system prompt transform, and chat file-part annotation handling.
- Dedicated `hashline_edit` tool with hash-anchored operations, optional `fileRev` checking, and `safeReapply` relocation.
- Structured hashline edit diagnostics with explicit codes (`HASH_MISMATCH`, `FILE_REV_MISMATCH`, `AMBIGUOUS_REAPPLY`, `TARGET_OUT_OF_RANGE`, `INVALID_REF`, `INVALID_RANGE`, `MISSING_REPLACEMENT`).
- Runtime hashline configuration loading from global/project config with cache, exclude patterns, max file size, prefix, `fileRev`, and `safeReapply` options.

### Changed

- Routing plugin now integrates shared hashline hooks and runtime configuration.
- Plugin registration now exposes `hashline_edit` and allows it in `opencode.json` permissions.
