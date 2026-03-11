import { performance } from "node:perf_hooks"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { runHashlineRead } from "../dist/.opencode/tools/hashline-core.js"

const PROJECT_ROOT = process.cwd()
const SHARED_STUB_FILE = 'import { getAdaptiveHashLength, hashlineAnchorHash, hashlineLineHash } from "../tools/hashline-core.js"'
const SHARED_STUB_REGEX = /import\s*\{\s*getAdaptiveHashLength\s*,\s*hashlineAnchorHash\s*,\s*hashlineLineHash\s*\}\s*from\s*"\.\.\/tools\/hashline-core"\s*;?/

const ITERATIONS = Number.parseInt(process.env.BENCH_ITERATIONS ?? "200", 10)
const SAMPLE = Array.from({ length: 400 }, (_, idx) => `line ${idx + 1} -> ${"x".repeat(48)}`).join("\n")

async function loadFormatWithHashline() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-bench-"))
  const toolsDir = path.join(tempDir, "tools")
  const pluginsDir = path.join(tempDir, "plugins")

  await fs.mkdir(toolsDir, { recursive: true })
  await fs.mkdir(pluginsDir, { recursive: true })

  await fs.copyFile(path.join(PROJECT_ROOT, "dist/.opencode/tools/hashline-core.js"), path.join(toolsDir, "hashline-core.js"))

  const originalShared = await fs.readFile(path.join(PROJECT_ROOT, "dist/.opencode/plugins/hashline-shared.js"), "utf8")
  const patchedShared = originalShared.replace(SHARED_STUB_REGEX, SHARED_STUB_FILE)

  await fs.writeFile(path.join(pluginsDir, "hashline-shared.js"), patchedShared, "utf8")
  await fs.writeFile(path.join(tempDir, "package.json"), '{"type":"module"}', "utf8")

  const sharedModule = await import(pathToFileURL(path.join(pluginsDir, "hashline-shared.js")).href)
  return { tempDir, formatWithHashline: sharedModule.formatWithHashline }
}

function timeSync(name, iterations, fn) {
  const start = performance.now()
  for (let i = 0; i < iterations; i += 1) {
    fn()
  }
  const totalMs = performance.now() - start
  const avgMs = totalMs / iterations
  console.log(`${name}: total=${totalMs.toFixed(2)}ms avg=${avgMs.toFixed(4)}ms (${iterations} iters)`)
}

async function timeAsync(name, iterations, fn) {
  const start = performance.now()
  for (let i = 0; i < iterations; i += 1) {
    await fn()
  }
  const totalMs = performance.now() - start
  const avgMs = totalMs / iterations
  console.log(`${name}: total=${totalMs.toFixed(2)}ms avg=${avgMs.toFixed(4)}ms (${iterations} iters)`)
}

async function main() {
  const { tempDir, formatWithHashline } = await loadFormatWithHashline()

  console.log(`Hashline microbench (iterations=${ITERATIONS})`)

  try {
    timeSync("formatWithHashline(sample)", ITERATIONS, () => {
      formatWithHashline(SAMPLE)
    })

    await timeAsync("runHashlineRead(README.md)", ITERATIONS, async () => {
      await runHashlineRead({ filePath: "README.md", context: { directory: process.cwd() } })
    })
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

await main()
