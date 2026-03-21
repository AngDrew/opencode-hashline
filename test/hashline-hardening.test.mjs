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

const PROJECT_ROOT = process.cwd()

const SHARED_STUB_IMPORT = "../lib/hashline-core.js"
const SHARED_STUB_FILE = `import { getAdaptiveHashLength, hashlineAnchorHash, hashlineLineHash } from \"${SHARED_STUB_IMPORT}\"\n`
const SHARED_STUB_REGEX = /import\s*\{\s*getAdaptiveHashLength\s*,\s*hashlineAnchorHash\s*,\s*hashlineLineHash\s*\}\s*from\s*"\.\.\/lib\/hashline-core"\s*;?/

async function loadSharedModule() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-shared-test-"))
  const toolsDir = path.join(tempDir, "tools")
  const pluginsDir = path.join(tempDir, "plugins")

  await fs.mkdir(toolsDir, { recursive: true })
  await fs.mkdir(pluginsDir, { recursive: true })

  await fs.copyFile(
    path.join(PROJECT_ROOT, "dist/.opencode/lib/hashline-core.js"),
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

async function loadBuiltToolModule(moduleFile) {
  const sandboxRoot = path.join(PROJECT_ROOT, ".slim")
  await fs.mkdir(sandboxRoot, { recursive: true })

  const tempDir = await fs.mkdtemp(path.join(sandboxRoot, "hashline-tool-module-"))
  const toolsDir = path.join(tempDir, "tools")
  await fs.mkdir(toolsDir, { recursive: true })

  await fs.copyFile(
    path.join(PROJECT_ROOT, "dist/.opencode/tools/hashline-core.js"),
    path.join(toolsDir, "hashline-core.js"),
  )

  for (const helperFile of ["read.js", "edit.js", "patch.js", "write.js"]) {
    const helperSource = await fs.readFile(path.join(PROJECT_ROOT, `dist/.opencode/tools/${helperFile}`), "utf8")
    const patchedHelperSource = helperSource
      .replace(/from "@opencode-ai\/plugin"/g, 'from "./plugin.js"')
      .replace(/from "\.\/hashline-core"/g, 'from "./hashline-core.js"')

    await fs.writeFile(path.join(toolsDir, helperFile), patchedHelperSource, "utf8")
  }

  await fs.writeFile(
    path.join(toolsDir, "plugin.js"),
    'import { z } from "zod"\nexport function tool(input) { return input }\ntool.schema = z\n',
    "utf8",
  )

  const toolSource = await fs.readFile(path.join(PROJECT_ROOT, `dist/.opencode/tools/${moduleFile}`), "utf8")
  const patchedToolSource = toolSource
    .replace(/from "@opencode-ai\/plugin"/g, 'from "./plugin.js"')
    .replace(/from "\.\/hashline-core"/g, 'from "./hashline-core.js"')

  await fs.writeFile(path.join(toolsDir, moduleFile), patchedToolSource, "utf8")
  await fs.writeFile(path.join(tempDir, "package.json"), '{"type":"module"}', "utf8")

  const moduleUrl = `${pathToFileURL(path.join(toolsDir, moduleFile)).href}?t=${Date.now()}`
  const mod = await import(moduleUrl)

  return {
    module: mod,
    async cleanup() {
      await fs.rm(tempDir, { recursive: true, force: true })
    },
  }
}

async function loadRoutingPluginModule() {
  const sandboxRoot = path.join(PROJECT_ROOT, ".slim")
  await fs.mkdir(sandboxRoot, { recursive: true })

  const tempDir = await fs.mkdtemp(path.join(sandboxRoot, "hashline-plugin-module-"))
  const pluginsDir = path.join(tempDir, "plugins")
  const toolsDir = path.join(tempDir, "tools")

  await fs.mkdir(pluginsDir, { recursive: true })
  await fs.mkdir(toolsDir, { recursive: true })

  const patchImports = (source) => source
    .replace(/from "\.\/hashline-hooks"/g, 'from "./hashline-hooks.js"')
    .replace(/from "\.\/hashline-shared"/g, 'from "./hashline-shared.js"')
    .replace(/from "\.\.\/tools\/hashline-core\.js"/g, 'from "../tools/hashline-core.js"')

  const routingSource = await fs.readFile(path.join(PROJECT_ROOT, "dist/.opencode/plugins/hashline-routing.js"), "utf8")
  const hooksSource = await fs.readFile(path.join(PROJECT_ROOT, "dist/.opencode/plugins/hashline-hooks.js"), "utf8")
  const sharedSource = await fs.readFile(path.join(PROJECT_ROOT, "dist/.opencode/plugins/hashline-shared.js"), "utf8")

  await fs.writeFile(path.join(pluginsDir, "hashline-routing.js"), patchImports(routingSource), "utf8")
  await fs.writeFile(path.join(pluginsDir, "hashline-hooks.js"), patchImports(hooksSource), "utf8")
  const patchedShared = patchImports(sharedSource).replace(SHARED_STUB_REGEX, SHARED_STUB_FILE.trimEnd())
  await fs.writeFile(path.join(pluginsDir, "hashline-shared.js"), patchedShared, "utf8")

  await fs.copyFile(
    path.join(PROJECT_ROOT, "dist/.opencode/tools/hashline-core.js"),
    path.join(toolsDir, "hashline-core.js"),
  )

  await fs.writeFile(path.join(tempDir, "package.json"), '{"type":"module"}', "utf8")

  const moduleUrl = `${pathToFileURL(path.join(pluginsDir, "hashline-routing.js")).href}?t=${Date.now()}`
  const mod = await import(moduleUrl)

  return {
    module: mod,
    async cleanup() {
      await fs.rm(tempDir, { recursive: true, force: true })
    },
  }
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

test("edit compatibility: operations[] should win when mixed payloads are sent", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-mixed-payload-"))
  const filePath = path.join(tempDir, "sample.txt")

  try {
    await fs.writeFile(filePath, "line one\nline two\n", "utf8")
    const before = await fs.readFile(filePath, "utf8")

    // Simulate the compatibility branch used by edit when callers send both styles:
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

test("hash-check validates guards and refs without writing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-check-"))
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

    const fileHash10 = (() => {
      const match = String(readText).match(/file_hash=\"([A-F0-9]{10})\"/)
      return match ? match[1] : undefined
    })()
    const line2Ref = (() => {
      const match = String(readText).match(/#HL\s+2#([A-F0-9]{3,4})#([A-F0-9]{3,4})\|beta/m)
      return match ? `2#${match[1]}#${match[2]}` : undefined
    })()

    assert.equal(typeof fileHash10, "string")
    assert.equal(typeof line2Ref, "string")

    const ok = await runHashlineCheck({
      filePath,
      fileRev: computeCoreFileRev(original),
      expectedFileHash: fileHash10,
      targets: [{ op: "replace", ref: line2Ref }],
      context: { directory: PROJECT_ROOT },
    })

    assert.match(ok, /Hashline check passed/)

    const after = await fs.readFile(filePath, "utf8")
    assert.equal(after, original)

    await assert.rejects(
      runHashlineCheck({
        filePath,
        fileRev: "00000000",
        context: { directory: PROJECT_ROOT },
      }),
      /File revision mismatch/,
    )
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("hashline operation result includes diff preview", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-diff-preview-"))
  const filePath = path.join(tempDir, "sample.txt")

  try {
    await fs.writeFile(filePath, "alpha\nbeta\ngamma\n", "utf8")

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

    const result = await runHashlineOperations({
      filePath,
      operations: [
        {
          op: "replace",
          ref: line2Ref,
          content: "beta updated",
        },
      ],
      context: { directory: PROJECT_ROOT },
    })

    assert.match(result, /Diff preview:/)
    assert.match(result, /```diff/)
    assert.match(result, /-beta/)
    assert.match(result, /\+beta updated/)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("edit wrapper maps operation snake_case refs and replacement alias", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-op-alias-"))
  const filePath = path.join(tempDir, "sample.txt")
  let cleanupToolModule = async () => {}

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

    const { module, cleanup } = await loadBuiltToolModule("edit.js")
    cleanupToolModule = cleanup
    const { default: editTool } = module

    const result = await editTool.execute(
      {
        filePath,
        operations: [
          {
            op: "replace",
            start_ref: line2Ref,
            end_ref: line2Ref,
            replacement: "beta aliased",
          },
        ],
      },
      { directory: PROJECT_ROOT },
    )

    assert.match(result, /Hashline hashline edit completed/)

    const after = await fs.readFile(filePath, "utf8")
    assert.equal(after, "alpha\nbeta aliased\ngamma\n")
  } finally {
    await cleanupToolModule()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("parsePatchText accepts snake_case object keys and nested operation aliases", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-patch-alias-"))
  const filePath = path.join(tempDir, "sample.txt")
  let cleanupToolModule = async () => {}

  try {
    const original = "alpha\nbeta\ngamma\n"
    await fs.writeFile(filePath, original, "utf8")

    const readText = await runHashlineRead({
      filePath,
      offset: 1,
      limit: 200,
      context: { directory: PROJECT_ROOT },
    })

    const fileHash10 = (() => {
      const match = String(readText).match(/file_hash=\"([A-F0-9]{10})\"/)
      return match ? match[1] : undefined
    })()
    const fileRev8 = (() => {
      const match = String(readText).match(/#HL REV:([A-F0-9]{8})/)
      return match ? match[1] : undefined
    })()
    const line2Ref = (() => {
      const match = String(readText).match(/#HL\s+2#([A-F0-9]{3,4})#([A-F0-9]{3,4})\|beta/m)
      return match ? `2#${match[1]}#${match[2]}` : undefined
    })()

    assert.equal(typeof fileHash10, "string")
    assert.equal(typeof fileRev8, "string")
    assert.equal(typeof line2Ref, "string")

    const { module, cleanup } = await loadBuiltToolModule("patch.js")
    cleanupToolModule = cleanup
    const { default: patchTool } = module

    const result = await patchTool.execute(
      {
        patchText: JSON.stringify({
          file_path: filePath,
          expected_file_hash: fileHash10,
          file_rev: fileRev8,
          operations: [
            {
              op: "replace",
              start_ref: line2Ref,
              end_ref: line2Ref,
              replacement: "beta patched alias",
            },
          ],
        }),
      },
      { directory: PROJECT_ROOT },
    )

    assert.match(result, /Hashline hashline edit (dry run )?completed/)

    const after = await fs.readFile(filePath, "utf8")
    assert.equal(after, "alpha\nbeta patched alias\ngamma\n")
  } finally {
    await cleanupToolModule()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("parsePatchText maps snake_case object aliases", () => {
  const parsed = parsePatchText(
    JSON.stringify({
      file_path: "a/b/sample.txt",
      expected_file_hash: "ABCDEF1234",
      file_rev: "1A2B3C4D",
      operations: [{ op: "set_file", content: "hello" }],
    }),
  )

  assert.equal(parsed.filePath, "a/b/sample.txt")
  assert.equal(parsed.expectedFileHash, "ABCDEF1234")
  assert.equal(parsed.fileRev, "1A2B3C4D")
  assert.equal(Array.isArray(parsed.operations), true)
  assert.equal(parsed.operations?.length, 1)
})

test("HashlineRouting normalizes nested edit operation aliases", async () => {
  let cleanupPluginModule = async () => {}

  try {
    const { module, cleanup } = await loadRoutingPluginModule()
    cleanupPluginModule = cleanup

    const { HashlineRouting: loadedRouting } = module
    const plugin = await loadedRouting({ directory: PROJECT_ROOT })
    const beforeHook = plugin["tool.execute.before"]

    assert.equal(typeof beforeHook, "function")

    const output = {
      args: {
        file_path: "demo.txt",
        operations: [
          {
            op: "replace",
            start_ref: "2#AAA#BBB",
            end_ref: "2#AAA#BBB",
            replacement: "next",
          },
        ],
      },
    }

    await beforeHook({ tool: "edit" }, output)

    assert.equal(output.args.filePath, "demo.txt")
    assert.equal(output.args.operations[0].startRef, "2#AAA#BBB")
    assert.equal(output.args.operations[0].endRef, "2#AAA#BBB")
    assert.equal(output.args.operations[0].content, "next")
  } finally {
    await cleanupPluginModule()
  }
})

test("hashline operation emits metadata diff", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-diff-metadata-"))
  const filePath = path.join(tempDir, "sample.txt")
  const metadataCalls = []

  try {
    await fs.writeFile(filePath, "alpha\nbeta\ngamma\n", "utf8")

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

    const result = await runHashlineOperations({
      filePath,
      operations: [
        {
          op: "replace",
          ref: line2Ref,
          content: "beta updated",
        },
      ],
      context: {
        directory: PROJECT_ROOT,
        metadata(input) {
          metadataCalls.push(input)
        },
      },
    })

    assert.match(result, /Diff preview:/)
    assert.equal(metadataCalls.length, 1)
    assert.equal(metadataCalls[0]?.metadata?.filepath, filePath)
    assert.deepEqual(metadataCalls[0]?.metadata?.filediff, {
      additions: 1,
      deletions: 1,
    })
    assert.equal(metadataCalls[0]?.metadata?.files?.[0]?.filepath, filePath)
    assert.match(String(metadataCalls[0]?.metadata?.diff), /^--- a\//m)
    assert.match(String(metadataCalls[0]?.metadata?.diff), /^\+\+\+ b\//m)
    assert.match(String(metadataCalls[0]?.metadata?.diff), /-beta/)
    assert.match(String(metadataCalls[0]?.metadata?.diff), /\+beta updated/)
    assert.match(String(metadataCalls[0]?.metadata?.diffPreview), /```diff/)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("write emits metadata diff through wrapper", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-write-wrapper-"))
  const filePath = path.join(tempDir, "sample.txt")
  const metadataCalls = []
  let cleanupToolModule = async () => {}

  try {
    const { module, cleanup } = await loadBuiltToolModule("write.js")
    cleanupToolModule = cleanup
    const { default: writeTool } = module

    const result = await writeTool.execute(
      {
        filePath,
        content: "alpha\nbeta\n",
        dryRun: true,
      },
      {
        directory: PROJECT_ROOT,
        metadata(input) {
          metadataCalls.push(input)
        },
      },
    )

    assert.match(result, /Diff preview:/)
    assert.equal(metadataCalls.length, 1)
    assert.deepEqual(metadataCalls[0]?.metadata?.filediff, {
      additions: 2,
      deletions: 0,
    })
    assert.match(String(metadataCalls[0]?.metadata?.diff), /^--- a\//m)
    assert.match(String(metadataCalls[0]?.metadata?.diff), /@@ -1,0 \+1,2 @@ set_file/)
    assert.match(String(metadataCalls[0]?.metadata?.diff), /\+alpha/)
    assert.match(String(metadataCalls[0]?.metadata?.diff), /\+beta/)
  } finally {
    await cleanupToolModule()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test("patch emits metadata diff through wrapper", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-patch-wrapper-"))
  const filePath = path.join(tempDir, "sample.txt")
  const metadataCalls = []
  let cleanupToolModule = async () => {}

  try {
    await fs.writeFile(filePath, "alpha\nbeta\ngamma\n", "utf8")

    const readText = await runHashlineRead({
      filePath,
      offset: 1,
      limit: 200,
      context: { directory: PROJECT_ROOT },
    })

    const fileRev = (() => {
      const match = String(readText).match(/#HL REV:([A-F0-9]{8})/)
      return match ? match[1] : undefined
    })()
    const line2Ref = (() => {
      const match = String(readText).match(/#HL\s+2#([A-F0-9]{3,4})#([A-F0-9]{3,4})\|beta/m)
      return match ? `2#${match[1]}#${match[2]}` : undefined
    })()

    assert.equal(typeof fileRev, "string")
    assert.equal(typeof line2Ref, "string")

    const { module, cleanup } = await loadBuiltToolModule("patch.js")
    cleanupToolModule = cleanup
    const { default: patchTool } = module

    const result = await patchTool.execute(
      {
        patchText: JSON.stringify({
          filePath,
          fileRev,
          operations: [
            {
              op: "replace",
              ref: line2Ref,
              content: "beta patched",
            },
          ],
        }),
        dryRun: true,
      },
      {
        directory: PROJECT_ROOT,
        metadata(input) {
          metadataCalls.push(input)
        },
      },
    )

    assert.match(result, /Diff preview:/)
    assert.equal(metadataCalls.length, 1)
    assert.deepEqual(metadataCalls[0]?.metadata?.filediff, {
      additions: 1,
      deletions: 1,
    })
    assert.match(String(metadataCalls[0]?.metadata?.diff), /^--- a\//m)
    assert.match(String(metadataCalls[0]?.metadata?.diff), /-beta/)
    assert.match(String(metadataCalls[0]?.metadata?.diff), /\+beta patched/)
  } finally {
    await cleanupToolModule()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
