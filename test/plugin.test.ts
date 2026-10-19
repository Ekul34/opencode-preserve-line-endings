import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { platform, tmpdir } from "node:os"
import { test, type TestContext } from "node:test"
import plugin from "../src/index.ts"

function fixture(t: TestContext) {
  const approved = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Temp", "opencode")
  const temporary = process.env.OPENCODE_TEST_TMP ?? (platform() === "win32" && approved && existsSync(approved)
    ? approved
    : tmpdir())
  const directory = mkdtempSync(path.join(temporary, "line-endings-test-"))
  const hooks = new Map<string, (event: never) => unknown>()
  const context = {
    location: { directory: path.join(directory, "not-the-session-directory") },
    session: { get: async () => ({ location: { directory } }) },
    tool: {
      async hook(name: string, callback: (event: never) => unknown) {
        hooks.set(name, callback)
        return { async dispose() { hooks.delete(name) } }
      },
    },
  } as unknown as Parameters<typeof plugin.setup>[0]
  t.after(() => rmSync(directory, { recursive: true, force: true }))

  const file = (name: string) => path.join(directory, name)
  const event = (tool: string, input: unknown, id = "call", sessionID = "session") =>
    ({ tool, input, id, sessionID, messageID: "message" })
  const invoke = async (name: string, value: object) => {
    assert.ok(hooks.has(name), `Missing ${name} hook`)
    await hooks.get(name)!(value as never)
  }

  return {
    context, hooks, file,
    before: (tool: string, input: unknown, id = "call", sessionID = "session") =>
      invoke("execute.before", event(tool, input, id, sessionID)),
    after: (tool: string, input: unknown, output: unknown, id = "call", sessionID = "session") =>
      invoke("execute.after", { ...event(tool, input, id, sessionID), status: "completed", result: { output } }),
    fail: (tool: string, input: unknown, id = "call") =>
      invoke("execute.after", { ...event(tool, input, id), status: "error", error: { message: "failed" } }),
    write: (name: string, content: string | Buffer) => writeFileSync(file(name), content),
    read: (name: string) => readFileSync(file(name), "utf8"),
  }
}

for (const tool of ["write", "edit"]) {
  for (const ending of ["\r\n", "\n"]) {
    test(`${tool} preserves existing ${JSON.stringify(ending)} after an LF rewrite`, async (t) => {
      const f = fixture(t)
      await plugin.setup(f.context)
      f.write("existing.txt", `old${ending}value${ending}`)
      await f.before(tool, { path: "existing.txt" })
      f.write("existing.txt", "new\nvalue\n")
      await f.after(tool, { path: "existing.txt" }, { target: f.file("existing.txt") })
      assert.equal(f.read("existing.txt"), `new${ending}value${ending}`)
    })
  }
}

test("new text follows platform defaults; Unix extensions and shebangs use LF", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  for (const [name, content, expected] of [
    ["new.cs", "first\nsecond\n", platform() === "win32" ? "first\r\nsecond\r\n" : "first\nsecond\n"],
    ["new.sh", "#!/bin/sh\r\necho ok\r\n", "#!/bin/sh\necho ok\n"],
    ["new.bash", "echo ok\r\n", "echo ok\n"],
    ["script", "#!/usr/bin/env bash\r\necho ok\r\n", "#!/usr/bin/env bash\necho ok\n"],
  ]) {
    await f.before("write", { path: name })
    f.write(name, content)
    await f.after("write", { path: name }, { target: f.file(name) })
    assert.equal(f.read(name), expected)
  }
})

test("preserves a UTF-8 BOM without duplication", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  for (const bom of ["", "\uFEFF"]) {
    f.write("bom.txt", "\uFEFFold\r\n")
    await f.before("write", { path: "bom.txt" })
    f.write("bom.txt", `${bom}new\n`)
    await f.after("write", {}, { target: f.file("bom.txt") })
    assert.equal(f.read("bom.txt"), "\uFEFFnew\r\n")
  }
})

test("absolute Windows paths with forward slashes match resolved tool output", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  f.write("absolute.txt", "old\r\n")
  await f.before("write", { path: f.file("absolute.txt").replaceAll("\\", "/") })
  f.write("absolute.txt", "new\n")
  await f.after("write", {}, { target: f.file("absolute.txt") })
  assert.equal(f.read("absolute.txt"), "new\r\n")
})

test("does not rewrite existing or newly produced NUL-containing files", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  f.write("binary.txt", Buffer.from([0, 10, 13, 255]))
  await f.before("write", { path: "binary.txt" })
  const rewritten = Buffer.from([0, 10, 255])
  f.write("binary.txt", rewritten)
  await f.after("write", {}, { target: f.file("binary.txt") })
  assert.deepEqual(readFileSync(f.file("binary.txt")), rewritten)
  await f.before("write", { path: "new.bin" })
  f.write("new.bin", rewritten)
  await f.after("write", {}, { target: f.file("new.bin") })
  assert.deepEqual(readFileSync(f.file("new.bin")), rewritten)
})

test("patch updates, adds and moves retain their source style; deletes are untouched", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  f.write("old.txt", "\uFEFFold\r\n")
  f.write("keep.txt", "old\n")
  f.write("delete.txt", "delete\r\n")
  const input = { patchText: [
    "*** Begin Patch", "*** Update File: old.txt", "*** Move to: renamed.sh", "@@", "-old", "+new",
    "*** Update File: keep.txt", "@@", "-old", "+new", "*** Add File: added.cs", "+new",
    "*** Add File: added.sh", "+echo ok", "*** Delete File: delete.txt", "*** End Patch",
  ].join("\r\n") }
  await f.before("patch", input)
  unlinkSync(f.file("old.txt"))
  unlinkSync(f.file("delete.txt"))
  f.write("renamed.sh", "new\n")
  f.write("keep.txt", "new\r\n")
  f.write("added.cs", "new\n")
  f.write("added.sh", "echo ok\r\n")
  await f.after("patch", input, { applied: [
    { type: "update", target: f.file("renamed.sh") },
    { type: "update", target: f.file("keep.txt") },
    { type: "add", target: f.file("added.cs") },
    { type: "add", target: f.file("added.sh") },
    { type: "delete", target: f.file("delete.txt") },
  ] })
  assert.equal(f.read("renamed.sh"), "\uFEFFnew\r\n")
  assert.equal(f.read("keep.txt"), "new\n")
  assert.equal(f.read("added.cs"), platform() === "win32" ? "new\r\n" : "new\n")
  assert.equal(f.read("added.sh"), "echo ok\n")
})

test("only normalizes successfully applied patch targets", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  f.write("not-applied.txt", "old\r\n")
  f.write("unrelated.txt", "old\n")
  await f.before("patch", { patchText: "*** Begin Patch\n*** Update File: not-applied.txt\n@@\n-old\n+new\n*** End Patch" })
  f.write("not-applied.txt", "external\n")
  await f.after("patch", {}, { applied: [{ type: "update", target: f.file("unrelated.txt") }] })
  assert.equal(f.read("not-applied.txt"), "external\n")
  assert.equal(f.read("unrelated.txt"), "old\n")
})

test("failed calls discard their snapshot without modifying files", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  f.write("failed.txt", "old\r\n")
  await f.before("write", { path: "failed.txt" })
  f.write("failed.txt", "partial\n")
  await f.fail("write", {})
  await f.after("write", {}, { target: f.file("failed.txt") })
  assert.equal(f.read("failed.txt"), "partial\n")
})

test("concurrent sessions with identical call IDs keep independent snapshots", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  f.write("shared.txt", "old\r\n")
  await f.before("write", { path: "shared.txt" }, "call", "session-a")
  f.write("shared.txt", "intermediate\n")
  await f.before("write", { path: "shared.txt" }, "call", "session-b")
  f.write("shared.txt", "new\n")
  await f.after("write", {}, { target: f.file("shared.txt") }, "call", "session-a")
  assert.equal(f.read("shared.txt"), "new\r\n")
  await f.after("write", {}, { target: f.file("shared.txt") }, "call", "session-b")
  assert.equal(f.read("shared.txt"), "new\n")
})

test("ignores shell, reads, invalid inputs and unmatched after events", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  f.write("untouched.txt", "value\n")
  for (const [tool, input] of [["shell", { path: "untouched.txt" }], ["read", { path: "untouched.txt" }], ["write", null]]) {
    await f.before(tool as string, input)
    await f.after(tool as string, input, { target: f.file("untouched.txt") })
  }
  assert.equal(f.read("untouched.txt"), "value\n")
})

test("cleanup disposes registrations and a fresh setup works", async (t) => {
  const f = fixture(t)
  const cleanup = await plugin.setup(f.context)
  assert.equal(f.hooks.size, 2)
  await cleanup()
  assert.equal(f.hooks.size, 0)
  const secondCleanup = await plugin.setup(f.context)
  assert.equal(f.hooks.size, 2)
  await secondCleanup()
})

test("Windows path casing does not discard the original snapshot", { skip: platform() !== "win32" }, async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  f.write("Casing.txt", "old\r\n")
  await f.before("write", { path: f.file("Casing.txt").toUpperCase() })
  f.write("Casing.txt", "new\n")
  await f.after("write", {}, { target: f.file("Casing.txt") })
  assert.equal(f.read("Casing.txt"), "new\r\n")
})

test("unsupported UTF-8 and UTF-16 bytes are not rewritten", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  for (const bytes of [Buffer.from([255, 254, 65, 0, 10, 0]), Buffer.from([255, 10, 254])]) {
    await f.before("write", { path: "encoding.txt" })
    f.write("encoding.txt", bytes)
    await f.after("write", {}, { target: f.file("encoding.txt") })
    assert.deepEqual(readFileSync(f.file("encoding.txt")), bytes)
  }
})

test("NUL bytes beyond the old sample boundary are not rewritten", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  const bytes = Buffer.concat([Buffer.from("x\n".repeat(5000)), Buffer.from([0])])
  await f.before("write", { path: "late-nul.txt" })
  f.write("late-nul.txt", bytes)
  await f.after("write", {}, { target: f.file("late-nul.txt") })
  assert.deepEqual(readFileSync(f.file("late-nul.txt")), bytes)
})

test("preserves the absence of a BOM on existing files", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  f.write("no-bom.txt", "old\r\n")
  await f.before("write", { path: "no-bom.txt" })
  f.write("no-bom.txt", "\uFEFFnew\n")
  await f.after("write", {}, { target: f.file("no-bom.txt") })
  assert.equal(f.read("no-bom.txt"), "new\r\n")
})

test("new BOM-prefixed extensionless Unix scripts use LF", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  await f.before("write", { path: "script" })
  f.write("script", "\uFEFF#!/usr/bin/env bash\r\necho ok\r\n")
  await f.after("write", {}, { target: f.file("script") })
  assert.equal(f.read("script"), "\uFEFF#!/usr/bin/env bash\necho ok\n")
})

test("patch context that looks like a header does not change the destination", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  f.write("context.txt", "old\r\n")
  const input = { patchText: "*** Begin Patch\n*** Update File: context.txt\n@@\n *** Move to: fake.txt\n-old\n+new\n*** End Patch" }
  await f.before("patch", input)
  f.write("context.txt", "new\n")
  await f.after("patch", input, { applied: [{ type: "update", target: f.file("context.txt") }] })
  assert.equal(f.read("context.txt"), "new\r\n")
})

test("mixed endings are normalized to CRLF if any original CRLF was present", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  f.write("mixed.txt", "a\r\nb\nc\r\n")
  await f.before("edit", { path: "mixed.txt" })
  f.write("mixed.txt", "a\nb\nc\n")
  await f.after("edit", {}, { target: f.file("mixed.txt") })
  assert.equal(f.read("mixed.txt"), "a\r\nb\r\nc\r\n")
})

test("preserves Unicode and the absence of a final newline", async (t) => {
  const f = fixture(t)
  await plugin.setup(f.context)
  f.write("unicode.txt", "old\r\nvalue")
  await f.before("write", { path: "unicode.txt" })
  f.write("unicode.txt", "café\n日本語 🌏")
  await f.after("write", {}, { target: f.file("unicode.txt") })
  assert.equal(f.read("unicode.txt"), "café\r\n日本語 🌏")
})
