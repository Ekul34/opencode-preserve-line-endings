# Changelog

## 0.1.1 — 2026-10-19

- Remove the `prepack` lifecycle hook: OpenCode's production Git installer must
  use the committed JavaScript without attempting a TypeScript build.
- Guard against installation lifecycle scripts in the package regression test.

## 0.1.0 — 2026-10-19

Initial public release for OpenCode 2.

- Snapshot original CRLF/LF and UTF-8 BOM state before mutation tools execute.
- Restore original style after successful `write`, `edit`, and `patch` calls.
- Carry source style through patch renames; do not recreate deleted files.
- Default new Windows text to CRLF and new Unix scripts to LF.
- Skip NUL-containing and invalid UTF-8 data.
- Isolate snapshots by tool call and resolve paths against the session directory.
- Ship dependency-free JavaScript, regression tests, and cross-platform CI.
