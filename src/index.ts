// Preserve each file's original style instead of enforcing a global EOL policy.
// New Windows text uses CRLF; new Unix scripts use LF. Only V2 mutation tools
// are covered, not shell commands. Regression tests: npm test.
import { isUtf8 } from "node:buffer"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { platform } from "node:os"
import type { Plugin } from "@opencode/plugin/promise/plugin"

type LineEnding = "\n" | "\r\n"

type FileStyle = {
  exists: boolean
  binary: boolean
  bom: boolean
  ending?: LineEnding
}

type FileChange = {
  source: string
  target: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

const unixScriptExtensions = new Set([
  ".bash",
  ".csh",
  ".fish",
  ".ksh",
  ".sh",
  ".tcsh",
  ".zsh",
])

function targetFiles(tool: string, input: unknown): FileChange[] {
  if (!record(input)) return []

  if (tool === "write" || tool === "edit") {
    return typeof input.path === "string" ? [{ source: input.path, target: input.path }] : []
  }

  if (tool === "patch") {
    return typeof input.patchText === "string" ? filesFromPatch(input.patchText) : []
  }

  return []
}

function resolvePath(filePath: string, worktree: string): string {
  return path.resolve(worktree, filePath)
}

function fileKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  return platform() === "win32" ? resolved.toLowerCase() : resolved
}

function filesFromPatch(patchText: string): FileChange[] {
  const files: FileChange[] = []
  let current: FileChange | undefined

  for (const line of patchText.split(/\r?\n/)) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line.trimEnd())
    if (header) {
      const filePath = header[2].trim()
      current = header[1] === "Delete" ? undefined : { source: filePath, target: filePath }
      if (current) files.push(current)
      continue
    }

    const move = /^\*\*\* Move to: (.+)$/.exec(line.trimEnd())
    // A renamed file inherits its source's style, not the new path's default.
    if (move && current) current.target = move[1].trim()
  }

  return files
}

function rememberStyle(absolutePath: string): FileStyle {
  if (!existsSync(absolutePath)) {
    return { exists: false, binary: false, bom: false }
  }

  return detectStyle(readFileSync(absolutePath))
}

function detectStyle(buffer: Buffer): FileStyle {
  // Never decode and rewrite unsupported encodings or binary-looking bytes.
  if (buffer.includes(0) || !isUtf8(buffer)) {
    return { exists: true, binary: true, bom: false }
  }

  const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
  const text = buffer.toString("utf8")

  return {
    exists: true,
    binary: false,
    bom,
    ending: text.includes("\r\n") ? "\r\n" : "\n",
  }
}

function normalizeEditedFile(absolutePath: string, style: FileStyle) {
  if (!existsSync(absolutePath)) return

  const buffer = readFileSync(absolutePath)
  const currentStyle = detectStyle(buffer)

  if (style.binary || currentStyle.binary) return

  const ending = style.exists && style.ending ? style.ending : defaultLineEnding(absolutePath, buffer)
  const preserveBom = style.exists ? style.bom : currentStyle.bom
  const normalized = normalizeText(buffer)
  const converted = convertLineEndings(normalized, ending)
  const content = preserveBom && !converted.startsWith("\uFEFF") ? `\uFEFF${converted}` : converted

  if (!buffer.equals(Buffer.from(content, "utf8"))) writeFileSync(absolutePath, content, "utf8")
}

function normalizeText(buffer: Buffer): string {
  let text = buffer.toString("utf8")
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1)
  }

  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
}

function convertLineEndings(text: string, ending: LineEnding): string {
  return ending === "\r\n" ? text.replaceAll("\n", "\r\n") : text
}

function defaultLineEnding(filePath: string, buffer: Buffer): LineEnding {
  if (shouldUseLf(filePath, buffer)) return "\n"
  return platform() === "win32" ? "\r\n" : "\n"
}

function shouldUseLf(filePath: string, buffer: Buffer): boolean {
  const extension = path.extname(filePath).toLowerCase()
  if (unixScriptExtensions.has(extension)) return true

  const firstLine = buffer.toString("utf8", 0, Math.min(buffer.length, 256)).replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0]
  return /^#!\/.*\b(?:ash|bash|dash|fish|ksh|sh|tcsh|zsh)\b/.test(firstLine)
}

export default {
  id: "preserve-line-endings",
  async setup(ctx) {
    // Scope snapshots to a tool call so concurrent sessions cannot overwrite them.
    const pending = new Map<string, Map<string, FileStyle>>()
    const callKey = (event: { sessionID: string; messageID: string; id: string }) =>
      JSON.stringify([event.sessionID, event.messageID, event.id])

    const before = await ctx.tool.hook("execute.before", async (event) => {
      const files = targetFiles(event.tool, event.input)
      if (files.length === 0) return

      // Sessions can move; the plugin instance's location is not always theirs.
      const session = await ctx.session.get({ sessionID: event.sessionID })
      const directory = session.location.directory
      const styles = new Map<string, FileStyle>()
      for (const file of files) {
        styles.set(fileKey(resolvePath(file.target, directory)), rememberStyle(resolvePath(file.source, directory)))
      }
      pending.set(callKey(event), styles)
    })

    const after = await ctx.tool.hook("execute.after", (event) => {
      const key = callKey(event)
      const styles = pending.get(key)
      pending.delete(key)
      if (!styles || event.status !== "completed") return

      // Only touch paths the successful built-in tool actually wrote.
      const output = event.result.output
      if (!record(output)) return
      const targets = event.tool === "patch" && Array.isArray(output.applied)
        ? output.applied.flatMap((change) =>
          record(change) && change.type !== "delete" && typeof change.target === "string" ? [change.target] : [])
        : typeof output.target === "string" ? [output.target] : []

      for (const target of new Set(targets)) {
        const style = styles.get(fileKey(target))
        if (style) normalizeEditedFile(target, style)
      }
    })

    return async () => {
      await after.dispose()
      await before.dispose()
      pending.clear()
    }
  },
} satisfies Plugin
