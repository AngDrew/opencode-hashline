import test from "node:test"
import assert from "node:assert/strict"

import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import { pathToFileURL } from "node:url"

import {
  computeFileRev as computeCoreFileRev,
  getAdaptiveHashLength,
  runHashlineRead,
  runHashlineOperations,
} from "../dist/.opencode/tools/hashline-core.js"

const PROJECT_ROOT = process.cwd()

const SHARED_STUB_IMPORT = "../tools/hashline-core.js"
const SHARED_STUB_FILE = `import { getAdaptiveHashLength, hashlineAnchorHash, hashlineLineHash } from \"${SHARED_STUB_IMPORT}\"\n`
const SHARED_STUB_REGEX = /import\s*\{\s*getAdaptiveHashLength\s*,\s*hashlineAnchorHash\s*,\s*hashlineLineHash\s*\}\s*from\s*"\.\.\/tools\/hashline-core"\s*;?/

async function loadSharedModule() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-shared-test-"))
  const toolsDir = path.join(tempDir, "tools")
  const pluginsDir = path.join(tempDir, "plugins")

  await fs.mkdir(toolsDir, { recursive: true })
  await fs.mkdir(pluginsDir, { recursive: true })

  await fs.copyFile(
    path.join(PROJECT_ROOT, "dist/.opencode/tools/hashline-core.js"),
    path.join(toolsDir, "hashline-core.js"),
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
  assert.match(formatted, /^;;;REV:[A-F0-9]{8}$/m)
  assert.equal(stripHashlinePrefixes(formatted), source)

  const noPrefixFormatted = formatWithHashline(source, { prefix: false })
  assert.match(noPrefixFormatted, /^1#[A-F0-9]{3}#[A-F0-9]{3}\|one$/m)
  assert.equal(stripHashlinePrefixes(noPrefixFormatted, false), source)
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

test("hash-edit compatibility: operations[] should win when mixed payloads are sent", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-mixed-payload-"))
  const filePath = path.join(tempDir, "sample.txt")

  try {
    await fs.writeFile(filePath, "line one\nline two\n", "utf8")
    const before = await fs.readFile(filePath, "utf8")

    // Simulate the compatibility branch used by hash-edit when callers send both styles:
    // execute operations[] and ignore top-level single-operation fields.
    await runHashlineOperations({
      filePath,
      operations: [
        {
          op: "set_file",
          content: "line one\nline two updated\n",
        },
      ],
      context: { directory: PROJECT_ROOT },
    })

    const after = await fs.readFile(filePath, "utf8")
    assert.notEqual(after, before)
    assert.equal(after, "line one\nline two updated\n")
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("fileRev accepts either #HL REV token (8) or file_hash token (10)", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-filerev-compat-"))
  const filePath = path.join(tempDir, "sample.txt")

  try {
    const original = "alpha\nbeta\ngamma\n"
    await fs.writeFile(filePath, original, "utf8")

    const readText = await runHashlineRead({
      filePath,
      offset: 1,
      limit: 200,
      context: { directory: PROJECT_ROOT },
    })

    const fileRev8 = computeCoreFileRev(original)
    const fileHash10 = (() => {
      const match = String(readText).match(/file_hash=\"([A-F0-9]{10})\"/)
      return match ? match[1] : undefined
    })()

    assert.match(fileRev8, /^[A-F0-9]{8}$/)
    assert.equal(typeof fileHash10, "string")
    assert.match(fileHash10, /^[A-F0-9]{10}$/)

    // Guarded by 8-char fileRev token should pass.
    await runHashlineOperations({
      filePath,
      operations: [
        {
          op: "set_file",
          content: original,
        },
      ],
      fileRev: fileRev8,
      context: { directory: PROJECT_ROOT },
    })

    // Guarded by 10-char file_hash token in fileRev should also pass (compat mode).
    await runHashlineOperations({
      filePath,
      operations: [
        {
          op: "set_file",
          content: original,
        },
      ],
      fileRev: fileHash10,
      context: { directory: PROJECT_ROOT },
    })

    const after = await fs.readFile(filePath, "utf8")
    assert.equal(after, original)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("replace accepts equivalent ref + startRef/endRef payloads", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-ref-compat-"))
  const filePath = path.join(tempDir, "sample.txt")

  try {
    const original = "alpha\nbeta\ngamma\n"
    await fs.writeFile(filePath, original, "utf8")

    const readText = await runHashlineRead({
      filePath,
      offset: 1,
      limit: 200,
      context: { directory: PROJECT_ROOT },
    })

    const line2Ref = (() => {
      const match = String(readText).match(/#HL\s+2#([A-F0-9]{3,4})#([A-F0-9]{3,4})\|beta/m)
      return match ? `2#${match[1]}#${match[2]}` : undefined
    })()

    assert.equal(typeof line2Ref, "string")

    await runHashlineOperations({
      filePath,
      operations: [
        {
          op: "replace",
          ref: line2Ref,
          startRef: line2Ref,
          endRef: line2Ref,
          content: "beta updated",
        },
      ],
      context: { directory: PROJECT_ROOT },
    })

    const after = await fs.readFile(filePath, "utf8")
    assert.equal(after, "alpha\nbeta updated\ngamma\n")
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
