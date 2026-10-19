# opencode-preserve-line-endings

[![CI](https://github.com/Ekul34/opencode-preserve-line-endings/actions/workflows/ci.yml/badge.svg)](https://github.com/Ekul34/opencode-preserve-line-endings/actions/workflows/ci.yml)
[![License: 0BSD](https://img.shields.io/badge/license-0BSD-blue.svg)](LICENSE)

**Keep a file's original line endings when OpenCode edits it.**

A small OpenCode 2 server plugin that remembers a file's line endings and UTF-8
byte order mark (BOM) **before** an edit, then restores that style **after** the
successful tool finishes. It also supplies platform-aware defaults for new files.

No runtime dependencies, configuration options, telemetry, or external services.

## Why this exists

Preserving a file's existing style is different from enforcing a project-wide
policy. A repository can legitimately contain CRLF Windows files and LF Unix
scripts. Converting everything to one style creates noisy diffs or broken scripts.

Detecting the style only *after* editing is too late: the edit may have already
changed a CRLF file to LF. This plugin snapshots the original style first.

## Install

Requires **OpenCode 2.0.32 or newer in the 2.x series**. OpenCode 1 is not supported.
Compatibility is tested against the 2.0.32 plugin contract; future releases may
require updates if OpenCode changes its tool API.

Add the GitHub release to `plugins` in your global
`~/.config/opencode/opencode.jsonc`, or a project `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "github:Ekul34/opencode-preserve-line-endings#v0.1.0"
  ]
}
```

Merge this entry with your existing plugins; do not replace unrelated settings.
OpenCode installs Git packages itself. A separate `npm install` is not required.
This release is distributed on GitHub, not the npm registry.

Alternatively, use the CLI for a global installation:

```sh
opencode plugin add 'github:Ekul34/opencode-preserve-line-endings#v0.1.0'
```

OpenCode normally reloads configuration automatically. Check `opencode plugin list`
for the ID **`preserve-line-endings`**. If the old definition remains loaded, restart
the service when no other sessions are running:

```sh
opencode service restart
```

### Local checkout

```sh
git clone https://github.com/Ekul34/opencode-preserve-line-endings.git
```

Configure the **directory**, not a direct file path:

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-preserve-line-endings"]
}
```

On Windows, JSON paths can use forward slashes, for example
`C:/Dev/opencode-preserve-line-endings`.

The root `index.ts` supports directory discovery. Git package installations use the
committed `dist/` build, so installation does not need a build or lifecycle script.

### Replacing the original standalone plugin

If you already have `plugins/preserve-line-endings.ts`, move it **outside** the
auto-discovered plugins directory and remove its explicit configuration entry
before enabling this package. Do not run two copies at the same time.

## Behavior

| File before the operation | Result |
| --- | --- |
| Existing CRLF text | CRLF is restored |
| Existing LF text | LF is restored |
| Existing UTF-8 BOM | BOM is preserved without duplication |
| Existing file without a BOM | Remains without a BOM |
| New ordinary text file on Windows | CRLF |
| New ordinary text file on Linux/macOS | LF |
| New Unix shell script | LF on every platform |
| Renamed file in a patch | Inherits its source's style and BOM |
| NUL-containing or invalid UTF-8 bytes | Not rewritten by this plugin |

Unix shell scripts are recognized by `.sh`, `.bash`, `.csh`, `.fish`, `.ksh`,
`.tcsh`, and `.zsh`, or a Unix shebang identifying a supported shell. The exception
is for **new** files; existing files retain their original style even if their
extension suggests a different convention.

Supported built-in tools: **`write`**, **`edit`**, and **`patch`**. Normalization
runs after successful execution and the built-in formatter. Only paths reported
as written by that tool are considered. Deleted files are not recreated.

Snapshots are scoped to the session, message, and tool call, and discarded after
the after-hook. Relative paths use the session's current directory, including
after a session moves. Windows path comparison is case-insensitive.

## Deliberate limits

- **Not a policy engine:** no `.editorconfig`, `.gitattributes`, or environment
  variable overrides. Use another tool if you want to enforce a project policy.
- **UTF-8 only:** NUL-containing and invalid UTF-8 data are left alone. This does
  not make OpenCode's own text tools safe for binary, UTF-16, or legacy-encoded files.
- **Not byte-for-byte mixed-ending preservation:** if any original CRLF exists,
  the file is normalized to CRLF; otherwise it uses LF. Lone CR separators are
  normalized too. Exact mixtures of endings are not retained.
- **No separate final-newline policy:** it preserves the final-newline state
  produced by the tool; it does not restore whether the original file ended with one.
- **Not atomic:** OpenCode writes first and the plugin corrects the result.
  Watchers can observe the intermediate bytes, and a crash between those steps can
  leave the tool's output uncorrected.
- **Failed and partially failed operations are not normalized:** OpenCode does
  not expose a successful applied-path result on failure. Inspect any partially
  applied files yourself.
- **No coverage for shell commands, MCP tools, third-party tools, or external
  editors.** Concurrent edits to the same file are not serialized by this plugin.
- Normalization reads the whole file and can rewrite it once. Unchanged files are
  not rewritten. This is intended for source/configuration files, not huge data files.

## Development

Node.js **22.18+** (or Node 24) and npm:

```sh
npm ci
npm run validate
npm pack --dry-run
```

`npm run validate` builds the dependency-free JavaScript entrypoint, type-checks the
tests, and exercises the hook behavior. CI runs on Windows, Linux, and macOS with
Node 22 and 24. Windows live OpenCode patch execution was also verified before the
initial release; the automated hook tests do not launch a model or OpenCode server.

Keep `dist/` synchronized with `src/`; it is intentionally committed for Git
installation. See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

## License

[0BSD](LICENSE) (BSD Zero Clause): use, copy, modify, and redistribute, commercially
or otherwise, without attribution requirements. Provided without warranty.

Independent community plugin; not affiliated with or endorsed by OpenCode.
