import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import plugin from "../dist/index.js"
import localPlugin from "../index.ts"

test("built package exports a V2 definition with no runtime dependencies", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  assert.equal(manifest.license, "0BSD")
  assert.equal(manifest.exports["./server"].import, "./dist/index.js")
  assert.equal(manifest.dependencies, undefined)
  assert.equal(plugin.id, "preserve-line-endings")
  assert.equal(typeof plugin.setup, "function")
  assert.equal(localPlugin.id, plugin.id)
})
