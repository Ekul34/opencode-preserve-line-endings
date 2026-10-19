# Contributing

Bug reports and focused pull requests are welcome. Contributions are released
under the repository's [0BSD license](LICENSE).

For a bug report, include your OpenCode version, operating system, tool name, and
a minimal example with the before/after line endings. Do not include credentials,
private source files, or unredacted session logs.

For development, use Node.js 22.18+ or 24:

```sh
npm ci
npm run validate
npm pack --dry-run
```

Add a regression test for behavior changes. Rebuild and include `dist/` changes:
Git installs must work without a build step or production dependencies. CI checks
that the committed build matches the TypeScript source.

The scope is preservation of existing per-file styles, not a configurable
line-ending policy engine. Changes must continue to leave unsupported encodings,
failed operations, and unrelated paths untouched.
