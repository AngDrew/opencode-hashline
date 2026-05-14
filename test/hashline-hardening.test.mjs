import test from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"

import {
  getAdaptiveHashLength,
  lineHash,
  anchorHash,
  computeFileRev,
} from "../dist/hash.js"

import { parseLineRef, formatAnnotatedLine } from "../dist/ref.js"

import { canonicalizeFileText, restoreFileText } from "../dist/file-text.js"

import { applyHashlineEdits, HashlineMismatchError } from "../dist/edit-ops.js"

import {
  formatWithHashline,
  stripHashlinePrefixes,
  shouldExclude,
  buildHashlineSystemInstruction,
  buildCacheEntryKey,
  HashlineAnnotationCache,
} from "../dist/shared.js"

import { createHashlineHooks } from "../dist/hooks.js"

// ── helpers ──────────────────────────────────────────────

const BASE_CONFIG = {
  exclude: [],
  maxFileSize: 1_048_576,
  cacheSize: 10,
  prefix: "#HL",
  fileRev: true,
  safeReapply: false,
}

function makeHooks(overrides = {}) {
  return createHashlineHooks({ ...BASE_CONFIG, ...overrides })
}

// ── hash ─────────────────────────────────────────────────

test("getAdaptiveHashLength uses 3 chars <=4096 and 4 chars above", () => {
  assert.equal(getAdaptiveHashLength(1), 3)
  assert.equal(getAdaptiveHashLength(4096), 3)
  assert.equal(getAdaptiveHashLength(4097), 4)
})

test("lineHash is deterministic SHA1 hex", () => {
  const h = lineHash("hello world")
  assert.equal(h.length, 4)
  assert.match(h, /^[A-F0-9]+$/)

  const h3 = lineHash("hello world", 3)
  assert.equal(h3.length, 3)

  const same = lineHash("hello world", 4)
  assert.equal(h, same)

  const different = lineHash("hello world!")
  assert.notEqual(h, different)
})

test("anchorHash uses tri-line context", () => {
  const ah = anchorHash("line1", "line2", "line3", 3)
  assert.equal(ah.length, 3)
  assert.match(ah, /^[A-F0-9]+$/)

  const ah2 = anchorHash("line1", "line2", "line3", 3)
  assert.equal(ah, ah2)

  const ah3 = anchorHash("line1", "line2", "line4", 3)
  assert.notEqual(ah, ah3)
})

test("computeFileRev stays consistent across newline styles", () => {
  const lf = "alpha\nbeta\ngamma\n"
  const crlf = lf.replace(/\n/g, "\r\n")
  const lfRev = computeFileRev(lf)
  const crlfRev = computeFileRev(crlf)
  assert.match(lfRev, /^[A-F0-9]{8}$/)
  assert.equal(lfRev, crlfRev)
  assert.notEqual(lfRev, computeFileRev("alpha\nbeta\ngamma\ndelta\n"))
})

// ── ref ──────────────────────────────────────────────────

test("parseLineRef parses hex refs with anchor", () => {
  const r = parseLineRef("#HL 12#A3F#9BC")
  assert.equal(r.lineNumber, 12)
  assert.equal(r.hash, "A3F")
  assert.equal(r.anchor, "9BC")
})

test("parseLineRef parses refs without prefix", () => {
  const r = parseLineRef("5#BEE")
  assert.equal(r.lineNumber, 5)
  assert.equal(r.hash, "BEE")
  assert.equal(r.anchor, undefined)
})

test("parseLineRef rejects invalid refs", () => {
  assert.throws(() => parseLineRef("abc#123"), /Invalid line reference/)
  assert.throws(() => parseLineRef("0#ABC"), /Invalid line number/)
})

test("formatAnnotatedLine produces correct output", () => {
  const lines = ["foo", "bar", "baz"]
  const result = formatAnnotatedLine("bar", 1, lines, "#HL", 3)
  assert.match(result, /^#HL 2#[A-F0-9]{3}#[A-F0-9]{3}\|bar$/)
})

// ── file-text ────────────────────────────────────────────

test("canonicalizeFileText strips BOM", () => {
  const e = canonicalizeFileText("\ufeffhello\nworld\n")
  assert.equal(e.hadBom, true)
  assert.equal(e.content, "hello\nworld\n")
  assert.equal(e.lineEnding, "\n")
})

test("canonicalizeFileText normalizes CRLF to LF", () => {
  const e = canonicalizeFileText("hello\r\nworld\r\n")
  assert.equal(e.lineEnding, "\r\n")
  assert.equal(e.content, "hello\nworld\n")
})

test("restoreFileText round-trips", () => {
  const raw = "\ufeffhello\r\nworld\r\n"
  const e = canonicalizeFileText(raw)
  const restored = restoreFileText(e.content, e)
  assert.equal(restored, raw)
})

// ── edit-ops ─────────────────────────────────────────────

test("applyHashlineEdits single line replace", () => {
  const content = "a\nb\nc"
  const result = applyHashlineEdits(content, [
    { op: "replace", pos: "2#" + lineHash("b", 3), lines: "B" },
  ])
  assert.equal(result.content, "a\nB\nc")
  assert.equal(result.noopEdits, 0)
})

test("applyHashlineEdits append to EOF", () => {
  const content = "a\nb"
  const result = applyHashlineEdits(content, [
    { op: "append", lines: ["c", "d"] },
  ])
  assert.equal(result.content, "a\nb\nc\nd")
})

test("applyHashlineEdits prepend to BOF", () => {
  const content = "b\nc"
  const result = applyHashlineEdits(content, [
    { op: "prepend", lines: ["a"] },
  ])
  assert.equal(result.content, "a\nb\nc")
})

test("applyHashlineEdits range replace", () => {
  const content = "a\nb\nc\nd\ne"
  const bHash = lineHash("b", 3)
  const dHash = lineHash("d", 3)
  const result = applyHashlineEdits(content, [
    {
      op: "replace",
      pos: "2#" + bHash,
      end: "4#" + dHash,
      lines: "X\nY",
    },
  ])
  assert.equal(result.content, "a\nX\nY\ne")
})

test("applyHashlineEdits insert after", () => {
  const content = "a\nb\nc"
  const bHash = lineHash("b", 3)
  const result = applyHashlineEdits(content, [
    {
      op: "append",
      pos: "2#" + bHash,
      lines: "B.5",
    },
  ])
  assert.equal(result.content, "a\nb\nB.5\nc")
})

test("applyHashlineEdits insert before", () => {
  const content = "a\nb\nc"
  const bHash = lineHash("b", 3)
  const result = applyHashlineEdits(content, [
    {
      op: "prepend",
      pos: "2#" + bHash,
      lines: "A.5",
    },
  ])
  assert.equal(result.content, "a\nA.5\nb\nc")
})

test("applyHashlineEdits noop detection", () => {
  const content = "a\nb\nc"
  const bHash = lineHash("b", 3)
  const result = applyHashlineEdits(content, [
    { op: "replace", pos: "2#" + bHash, lines: "b" },
  ])
  assert.equal(result.noopEdits, 1)
  assert.equal(result.content, "a\nb\nc")
})

test("applyHashlineEdits detects mismatches", () => {
  assert.throws(
    () => applyHashlineEdits("a\nb\nc", [
      { op: "replace", pos: "2#ZZZ", lines: "X" },
    ]),
    HashlineMismatchError,
  )
})

test("HashlineMismatchError has remaps", () => {
  try {
    applyHashlineEdits("a\nb\nc", [
      { op: "replace", pos: "2#ZZZ", lines: "X" },
    ])
    assert.fail("should throw")
  } catch (e) {
    if (e instanceof HashlineMismatchError) {
      assert.equal(e.remaps.size, 1)
      assert.match(e.message, />>> /)
    } else {
      throw e
    }
  }
})

// ── shared ───────────────────────────────────────────────

test("formatWithHashline and stripHashlinePrefixes round-trip", () => {
  const source = "one\ntwo\nthree"
  const formatted = formatWithHashline(source, "#HL", true)
  assert.match(formatted, /^#HL REV:[A-F0-9]{8}$/m)
  assert.match(formatted, /^#HL 1#[A-F0-9]{3}#[A-F0-9]{3}\|one$/m)
  assert.equal(stripHashlinePrefixes(formatted, "#HL"), source)

  const noPrefix = formatWithHashline(source, false, false)
  assert.match(noPrefix, /^1#[A-F0-9]{3}#[A-F0-9]{3}\|one$/m)
  assert.equal(stripHashlinePrefixes(noPrefix, false), source)
})

test("shouldExclude matches glob patterns", () => {
  const patterns = ["**/node_modules/**", "**/*.min.js", "src/**/*.ts", "**/.env.*"]
  assert.equal(shouldExclude("packages/node_modules/lib/index.js", patterns), true)
  assert.equal(shouldExclude("dist/app.min.js", patterns), true)
  assert.equal(shouldExclude("src/utils/file.ts", patterns), true)
  assert.equal(shouldExclude("config/.env.production", patterns), true)
  assert.equal(shouldExclude("src/utils/file.js", patterns), false)
  assert.equal(shouldExclude("README.md", patterns), false)
})

test("system instruction is config-aware", () => {
  const instruction = buildHashlineSystemInstruction({
    prefix: ";;;", fileRev: true, maxFileSize: 0, cacheSize: 10, exclude: [], safeReapply: false,
  })
  assert.match(instruction, /Hashline workflow:/)
  assert.match(instruction, /batch same-file changes into one edit call/i)
  assert.match(instruction, /Reread only when you need more context/i)
})

test("system instruction handles prefix disabled", () => {
  const instruction = buildHashlineSystemInstruction({
    prefix: false, fileRev: true, maxFileSize: 0, cacheSize: 10, exclude: [], safeReapply: false,
  })
  assert.match(instruction, /Active prefix: none/)
})

test("buildCacheEntryKey handles various parts", () => {
  const key = buildCacheEntryKey("/base", 1, 50)
  assert.equal(key, "/base\u00001\u000050")
  const key2 = buildCacheEntryKey("/base")
  assert.equal(key2, "/base")
})

test("HashlineAnnotationCache basic operations", () => {
  const cache = new HashlineAnnotationCache(3)
  assert.equal(cache.get("k1", "source"), null)
  cache.set("k1", "source", "annotated")
  assert.equal(cache.get("k1", "source"), "annotated")
  cache.invalidate("k1")
  assert.equal(cache.get("k1", "source"), null)
})

test("HashlineAnnotationCache evicts oldest when full", () => {
  const cache = new HashlineAnnotationCache(2)
  cache.set("a", "1", "A")
  cache.set("b", "2", "B")
  cache.set("c", "3", "C")
  assert.equal(cache.get("a", "1"), null)
  assert.equal(cache.get("b", "2"), "B")
  assert.equal(cache.get("c", "3"), "C")
})

// ── hooks ────────────────────────────────────────────────

test("glob and grep are not treated as reads", async () => {
  const hooks = makeHooks()
  const globOutput = { output: "src/file.ts\nsrc/other.ts" }
  await hooks["tool.execute.after"]?.(
    { tool: "glob", args: { path: "src/file.ts" } },
    globOutput,
  )
  assert.equal(globOutput.output, "src/file.ts\nsrc/other.ts")

  const grepOutput = { output: "src/file.ts:1:hello" }
  await hooks["tool.execute.after"]?.(
    { tool: "grep", args: { path: "src/file.ts" } },
    grepOutput,
  )
  assert.equal(grepOutput.output, "src/file.ts:1:hello")
})

test("read hook refreshes cached annotations when file changes", async () => {
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

test("system instruction is injected via transform hook", async () => {
  const hooks = makeHooks({ prefix: ";;;" })
  const transform = hooks["experimental.chat.system.transform"]
  assert.equal(typeof transform, "function")

  const output = { system: ["intro"] }
  await transform?.({ model: {} }, output)
  assert.equal(output.system.length, 2)
  assert.match(output.system[1], /Hashline workflow:/)
  assert.match(output.system[1], /Active prefix: ";;;"/)
})

test("tool definitions guide agents", async () => {
  const hooks = makeHooks()
  const definition = hooks["tool.definition"]
  assert.equal(typeof definition, "function")

  const readOut = { description: "native read", parameters: {} }
  await definition?.({ toolID: "read" }, readOut)
  assert.match(readOut.description, /canonical #HL refs plus a REV token/i)
  assert.match(readOut.description, /plan all same-file changes before calling edit/i)

  const writeOut = { description: "native write", parameters: {} }
  await definition?.({ toolID: "write" }, writeOut)
  assert.match(writeOut.description, /Use write for new files or full rewrites/i)
})

// ── edit-executor integration ────────────────────────────

test("edit executor applies operations to real files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-exec-test-"))
  const filePath = path.join(tempDir, "test.txt")
  try {
    await fs.writeFile(filePath, "line1\nline2\nline3\n", "utf8")
    const raw = await fs.readFile(filePath, "utf8")
    const lines = raw.split("\n").filter(Boolean)
    const hash2 = lineHash(lines[1], getAdaptiveHashLength(lines.length))

    const { executeEditTool } = await import("../dist/edit-executor.js")
    const mockCtx = {
      sessionID: "test",
      messageID: "test",
      agent: "test",
      directory: tempDir,
      worktree: tempDir,
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    }

    const result = await executeEditTool({
      filePath,
      operations: [{ op: "replace", startRef: `2#${hash2}`, content: "LINE2" }],
    }, mockCtx)

    assert.match(result, /^Updated /)
    const content = await fs.readFile(filePath, "utf8")
    assert.equal(content.trim(), "line1\nLINE2\nline3")
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("edit executor handles oldString/newString fallback", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-legacy-test-"))
  const filePath = path.join(tempDir, "test.txt")
  try {
    await fs.writeFile(filePath, "hello world\n", "utf8")
    const { executeEditTool } = await import("../dist/edit-executor.js")
    const mockCtx = { ask: async () => {}, metadata: () => {} }

    const result = await executeEditTool({
      filePath,
      oldString: "hello world",
      newString: "HELLO WORLD",
    }, mockCtx)

    assert.match(result, /^Updated /)
    const content = await fs.readFile(filePath, "utf8")
    assert.equal(content.trim(), "HELLO WORLD")
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
