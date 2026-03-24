import test from "node:test"
import assert from "node:assert/strict"

import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import { pathToFileURL } from "node:url"

import {
  computeFileRev as computeCoreFileRev,
  getAdaptiveHashLength,
} from "../dist/.opencode/lib/hashline-core.js"
import { createHashlineHooks } from "../dist/.opencode/plugins/hashline-hooks.js"

const PROJECT_ROOT = process.cwd()

const SHARED_STUB_IMPORT = "../lib/hashline-core.js"
const SHARED_STUB_FILE = `import { getAdaptiveHashLength, hashlineAnchorHash, hashlineLineHash } from \"${SHARED_STUB_IMPORT}\"\n`
const SHARED_STUB_REGEX = /import\s*\{\s*getAdaptiveHashLength\s*,\s*hashlineAnchorHash\s*,\s*hashlineLineHash\s*\}\s*from\s*"\.\.\/lib\/hashline-core"\s*;?/

async function loadSharedModule() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-shared-test-"))
  const libDir = path.join(tempDir, "lib")
  const pluginsDir = path.join(tempDir, "plugins")

  await fs.mkdir(libDir, { recursive: true })
  await fs.mkdir(pluginsDir, { recursive: true })

  await fs.copyFile(
    path.join(PROJECT_ROOT, "dist/.opencode/lib/hashline-core.js"),
    path.join(libDir, "hashline-core.js"),
  )
  await fs.copyFile(
    path.join(PROJECT_ROOT, "dist/.opencode/plugins/hashline-contract.js"),
    path.join(pluginsDir, "hashline-contract.js"),
  )

  const originalShared = await fs.readFile(path.join(PROJECT_ROOT, "dist/.opencode/plugins/hashline-shared.js"), "utf8")
  const patchedShared = originalShared.replace(SHARED_STUB_REGEX, SHARED_STUB_FILE.trimEnd())

  await fs.writeFile(path.join(pluginsDir, "hashline-shared.js"), patchedShared, "utf8")
  await fs.writeFile(path.join(tempDir, "package.json"), '{"type":"module"}', "utf8")

  const moduleUrl = pathToFileURL(path.join(pluginsDir, "hashline-shared.js"))
  const shared = await import(moduleUrl.href)

  return { tempDir, shared }
}

const { tempDir: sharedTempDir, shared } = await loadSharedModule()
const {
  computeFileRev: computeSharedFileRev,
  formatWithHashline,
  shouldExclude,
  stripHashlinePrefixes,
} = shared

test.after(async () => {
  await fs.rm(sharedTempDir, { recursive: true, force: true })
})

test("getAdaptiveHashLength uses 3 chars <=4096 lines and 4 chars above", () => {
  assert.equal(getAdaptiveHashLength(1), 3)
  assert.equal(getAdaptiveHashLength(4096), 3)
  assert.equal(getAdaptiveHashLength(4097), 4)
})

test("computeFileRev stays consistent across newline styles", () => {
  const lf = "alpha\nbeta\ngamma\n"
  const crlf = lf.replace(/\n/g, "\r\n")

  const coreLf = computeCoreFileRev(lf)
  const coreCrlf = computeCoreFileRev(crlf)
  const sharedLf = computeSharedFileRev(lf)
  const sharedCrlf = computeSharedFileRev(crlf)

  assert.match(coreLf, /^[A-F0-9]{8}$/)
  assert.equal(coreLf, coreCrlf)
  assert.equal(coreLf, sharedLf)
  assert.equal(sharedLf, sharedCrlf)
  assert.notEqual(coreLf, computeCoreFileRev("alpha\nbeta\ngamma\ndelta\n"))
})

test("formatWithHashline and stripHashlinePrefixes round-trip basics", () => {
  const source = "one\ntwo\nthree"

  const formatted = formatWithHashline(source, { includeFileRev: true })
  assert.match(formatted, /^#HL REV:[A-F0-9]{8}$/m)
  assert.match(formatted, /^#HL 1#[A-F0-9]{3}#[A-F0-9]{3}\|one$/m)
  assert.equal(stripHashlinePrefixes(formatted), source)

  const noPrefixFormatted = formatWithHashline(source, { prefix: false })
  assert.match(noPrefixFormatted, /^1#[A-F0-9]{3}#[A-F0-9]{3}\|one$/m)
  assert.equal(stripHashlinePrefixes(noPrefixFormatted, false), source)
})

test("glob and grep are not treated as reads", async () => {
  const hooks = createHashlineHooks({
    exclude: [],
    maxFileSize: 1_048_576,
    cacheSize: 10,
    prefix: "#HL",
    fileRev: true,
    safeReapply: false,
  })

  const globOutput = { output: "src/file.ts\nsrc/other.ts" }
  await hooks["tool.execute.after"]?.({ tool: "glob", args: { path: "src/file.ts" } }, globOutput)
  assert.equal(globOutput.output, "src/file.ts\nsrc/other.ts")

  const grepOutput = { output: "src/file.ts:1:hello" }
  await hooks["tool.execute.after"]?.({ tool: "grep", args: { path: "src/file.ts" } }, grepOutput)
  assert.equal(grepOutput.output, "src/file.ts:1:hello")
})

test("shouldExclude matches common glob-style patterns", () => {
  const patterns = ["**/node_modules/**", "**/*.min.js", "src/**/*.ts", "**/.env.*"]

  assert.equal(shouldExclude("packages/node_modules/lib/index.js", patterns), true)
  assert.equal(shouldExclude("dist/app.min.js", patterns), true)
  assert.equal(shouldExclude("src/utils/file.ts", patterns), true)
  assert.equal(shouldExclude("src\\utils\\file.ts", patterns), true)
  assert.equal(shouldExclude("config/.env.production", patterns), true)
  assert.equal(shouldExclude("src/utils/file.js", patterns), false)
  assert.equal(shouldExclude("README.md", patterns), false)
})
