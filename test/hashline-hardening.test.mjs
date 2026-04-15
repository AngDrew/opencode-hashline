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
  buildHashlineSystemInstruction,
  computeFileRev: computeSharedFileRev,
  formatWithHashline,
  shouldExclude,
  stripHashlinePrefixes,
} = shared

const BASE_CONFIG = {
  exclude: [],
  maxFileSize: 1_048_576,
  cacheSize: 10,
  prefix: "#HL",
  fileRev: true,
  safeReapply: false,
}

function makeHooks(overrides = {}) {
  return createHashlineHooks({
    ...BASE_CONFIG,
    ...overrides,
  })
}

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
  const hooks = makeHooks()

  const globOutput = { output: "src/file.ts\nsrc/other.ts" }
  await hooks["tool.execute.after"]?.({ tool: "glob", args: { path: "src/file.ts" } }, globOutput)
  assert.equal(globOutput.output, "src/file.ts\nsrc/other.ts")

  const grepOutput = { output: "src/file.ts:1:hello" }
  await hooks["tool.execute.after"]?.({ tool: "grep", args: { path: "src/file.ts" } }, grepOutput)
  assert.equal(grepOutput.output, "src/file.ts:1:hello")
})

test("read hook refreshes cached annotations when file content changes", async () => {
  const hooks = makeHooks()

  const afterHook = hooks["tool.execute.after"]
  assert.equal(typeof afterHook, "function")

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-read-cache-test-"))
  const filePath = path.join(tempDir, "sample.txt")

  try {
    await fs.writeFile(filePath, "alpha\nbeta\n", "utf8")

    const firstOutput = { output: "alpha\nbeta\n" }
    await afterHook?.({ tool: "read", args: { path: filePath, offset: 1, limit: 50 } }, firstOutput)

    assert.equal(String(firstOutput.output).includes("beta"), true)
    assert.equal(String(firstOutput.output).includes("gamma"), false)

    await fs.writeFile(filePath, "alpha\ngamma\n", "utf8")

    const secondOutput = { output: "alpha\ngamma\n" }
    await afterHook?.({ tool: "read", args: { path: filePath, offset: 1, limit: 50 } }, secondOutput)

    assert.equal(String(secondOutput.output).includes("beta"), false)
    assert.equal(String(secondOutput.output).includes("gamma"), true)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
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

test("system instruction is config-aware and batch-first", () => {
  const instruction = buildHashlineSystemInstruction({ prefix: ";;;" })

  assert.match(instruction, /Hashline workflow:/)
  assert.match(instruction, /`#HL 12#A3F#9BC`/)
  assert.match(instruction, /`#HL REV:72C4946C`/)
  assert.match(instruction, /Active helper prefix from config: ";;;"/)
  assert.match(instruction, /Read output stays canonical `#HL`/)
  assert.match(instruction, /batch same-file changes into one edit call with operations\[\]/i)
  assert.match(instruction, /Reread only when you need more context or an edit fails because refs are stale/i)
})

test("system instruction handles prefix disabled", () => {
  const instruction = buildHashlineSystemInstruction({ prefix: false })

  assert.match(instruction, /Active helper prefix from config: none/)
  assert.match(instruction, /Read output stays canonical `#HL`/)
})

test("system instruction falls back to the default prefix when config prefix is missing", async () => {
  const hooks = makeHooks({ prefix: undefined })
  const output = { system: ["intro"] }
  const transform = hooks["experimental.chat.system.transform"]

  if (!transform) {
    throw new Error("Missing system transform hook")
  }

  await transform({ model: {} }, output)

  assert.equal(output.system.length, 2)
  assert.match(output.system[1], /Active helper prefix from config: "#HL"/)
  assert.match(output.system[1], /Read output stays canonical `#HL`/)
})

test("tool descriptions guide agents toward batched edit workflows", async () => {
  const hooks = makeHooks()
  const definition = hooks["tool.definition"]

  assert.equal(typeof definition, "function")

  const readOutput = { description: "native read", parameters: {} }
  await definition?.({ toolID: "read" }, readOutput)
  assert.match(readOutput.description, /canonical #HL refs plus a REV token/i)
  assert.match(readOutput.description, /plan all same-file changes before calling edit/i)

  const editOutput = { description: "native edit", parameters: {} }
  await definition?.({ toolID: "edit" }, editOutput)
  assert.match(editOutput.description, /Accepts refs copied from read/i)
  assert.match(editOutput.description, /Prefer one batched call per file/i)
  assert.match(editOutput.description, /operations:\[\{ op, ref\|startRef\/endRef, content\? \}\]/i)

  const writeOutput = { description: "native write", parameters: {} }
  await definition?.({ toolID: "write" }, writeOutput)
  assert.match(writeOutput.description, /Use write for new files or full rewrites/i)
  assert.match(writeOutput.description, /Prefer edit for targeted existing-file changes/i)
})
