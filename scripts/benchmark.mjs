import { performance } from "node:perf_hooks"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  mapOperationInput,
  parsePatchText,
  parseRaw,
  runHashlineOperations,
  runHashlineRead,
  stringifyLines,
} from "../dist/.opencode/lib/hashline-core.js"

const PROJECT_ROOT = process.cwd()
const SHARED_STUB_FILE = 'import { getAdaptiveHashLength, hashlineAnchorHash, hashlineLineHash } from "../lib/hashline-core.js"'
const SHARED_STUB_REGEX = /import\s*\{\s*getAdaptiveHashLength\s*,\s*hashlineAnchorHash\s*,\s*hashlineLineHash\s*\}\s*from\s*"\.\.\/lib\/hashline-core"\s*;?/

const PERF_ITERATIONS = readPositiveIntEnv("BENCH_ITERATIONS", 200)
const CORRECTNESS_FIXTURES = readPositiveIntEnv("BENCH_FIXTURES", 120)
const CORRECTNESS_RUNS = readPositiveIntEnv("BENCH_RUNS", 2)
const BENCH_SEED = readPositiveIntEnv("BENCH_SEED", 1337)

const SAMPLE = Array.from({ length: 400 }, (_, idx) => `line ${idx + 1} -> ${"x".repeat(48)}`).join("\n")
const INCLUDED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml"])
const EXCLUDED_DIRS = new Set([".git", "node_modules", "dist"])
const MAX_FIXTURE_FILE_BYTES = 256_000
const MAX_FIXTURE_LINE_LENGTH = 240

const MUTATION_RULES = [
  {
    name: "strict-equality-flip",
    mutate: (line) => (line.includes("===") ? line.replace("===", "!==") : null),
  },
  {
    name: "loose-equality-flip",
    mutate: (line) => {
      if (line.includes("!==")) {
        return null
      }
      return line.includes("==") ? line.replace("==", "!=") : null
    },
  },
  {
    name: "boolean-true-false",
    mutate: (line) => (line.includes("true") ? line.replace(/\btrue\b/, "false") : null),
  },
  {
    name: "boolean-false-true",
    mutate: (line) => (line.includes("false") ? line.replace(/\bfalse\b/, "true") : null),
  },
  {
    name: "and-or-flip",
    mutate: (line) => (line.includes("&&") ? line.replace("&&", "||") : null),
  },
  {
    name: "or-and-flip",
    mutate: (line) => (line.includes("||") ? line.replace("||", "&&") : null),
  },
  {
    name: "gte-gt",
    mutate: (line) => (line.includes(">=") ? line.replace(">=", ">") : null),
  },
  {
    name: "lte-lt",
    mutate: (line) => (line.includes("<=") ? line.replace("<=", "<") : null),
  },
  {
    name: "plus-minus-one",
    mutate: (line) => (line.match(/\+\s*1\b/) ? line.replace(/\+\s*1\b/, "- 1") : null),
  },
  {
    name: "minus-plus-one",
    mutate: (line) => (line.match(/-\s*1\b/) ? line.replace(/-\s*1\b/, "+ 1") : null),
  },
]

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }

  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return value
}

function createRng(seed) {
  let state = seed >>> 0
  if (state === 0) {
    state = 0x9e3779b9
  }

  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function seededShuffle(items, seed) {
  const out = [...items]
  const random = createRng(seed)
  for (let idx = out.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(random() * (idx + 1))
    const current = out[idx]
    out[idx] = out[swapIdx]
    out[swapIdx] = current
  }
  return out
}

function applyMutation(line) {
  for (const rule of MUTATION_RULES) {
    const mutatedLine = rule.mutate(line)
    if (typeof mutatedLine === "string" && mutatedLine !== line) {
      return {
        mutation: rule.name,
        mutatedLine,
      }
    }
  }

  return null
}

function countLineOccurrences(lines, lineValue) {
  let count = 0
  for (const line of lines) {
    if (line === lineValue) {
      count += 1
    }
  }
  return count
}

function extractFileRev(readOutput) {
  const match = readOutput.match(/#HL REV:([A-F0-9]{8})/)
  return match ? match[1] : null
}

function extractRef(readOutput, lineNumber) {
  const pattern = new RegExp(`^#HL\\s+${lineNumber}#([A-Z0-9]+)#([A-Z0-9]+)\\|`, "m")
  const match = readOutput.match(pattern)
  if (!match) {
    return null
  }

  return `${lineNumber}#${match[1]}#${match[2]}`
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("File revision mismatch")) {
    return "FILE_REV_MISMATCH"
  }
  if (message.includes("Hash mismatch")) {
    return "HASH_MISMATCH"
  }
  if (message.includes("No operations found")) {
    return "EMPTY_PATCH_OPERATIONS"
  }
  return message.split("\n", 1)[0]
}

function incrementCount(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function printResultsTable(rows) {
  const headers = ["strategy", "pass", "fail", "pass%", "avg ms/task"]
  const widths = [26, 8, 8, 9, 13]

  const format = (value, width, align = "left") => {
    const text = String(value)
    if (text.length >= width) {
      return text
    }
    const pad = " ".repeat(width - text.length)
    return align === "right" ? `${pad}${text}` : `${text}${pad}`
  }

  const headerLine = [
    format(headers[0], widths[0]),
    format(headers[1], widths[1], "right"),
    format(headers[2], widths[2], "right"),
    format(headers[3], widths[3], "right"),
    format(headers[4], widths[4], "right"),
  ].join(" ")

  console.log(headerLine)
  console.log("-".repeat(headerLine.length))

  for (const row of rows) {
    console.log(
      [
        format(row.strategy, widths[0]),
        format(row.pass, widths[1], "right"),
        format(row.fail, widths[2], "right"),
        format(row.passRate.toFixed(1), widths[3], "right"),
        format(row.avgMsPerTask.toFixed(3), widths[4], "right"),
      ].join(" "),
    )
  }
}

async function loadFormatWithHashline() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-bench-"))
  const toolsDir = path.join(tempDir, "tools")
  const pluginsDir = path.join(tempDir, "plugins")

  await fs.mkdir(toolsDir, { recursive: true })
  await fs.mkdir(pluginsDir, { recursive: true })

  await fs.copyFile(path.join(PROJECT_ROOT, "dist/.opencode/lib/hashline-core.js"), path.join(toolsDir, "hashline-core.js"))

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

async function collectSourceFiles(rootDir) {
  const files = []

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue
        }
        await walk(absolutePath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const ext = path.extname(entry.name).toLowerCase()
      if (!INCLUDED_EXTENSIONS.has(ext)) {
        continue
      }

      files.push(path.relative(rootDir, absolutePath))
    }
  }

  await walk(rootDir)
  return files
}

async function buildFixtures(rootDir, targetCount, seed) {
  const files = await collectSourceFiles(rootDir)
  const candidates = []

  for (const relativePath of files) {
    const absolutePath = path.join(rootDir, relativePath)
    const raw = await fs.readFile(absolutePath, "utf8")
    if (Buffer.byteLength(raw, "utf8") > MAX_FIXTURE_FILE_BYTES) {
      continue
    }

    const parsed = parseRaw(raw)
    for (let idx = 0; idx < parsed.lines.length; idx += 1) {
      const line = parsed.lines[idx]
      if (!line || line.length > MAX_FIXTURE_LINE_LENGTH) {
        continue
      }

      const mutation = applyMutation(line)
      if (!mutation) {
        continue
      }

      const mutatedLines = [...parsed.lines]
      mutatedLines[idx] = mutation.mutatedLine
      const mutatedContent = stringifyLines(mutatedLines, parsed.eol, parsed.endsWithNewline)
      const ambiguousForLegacy = countLineOccurrences(mutatedLines, mutation.mutatedLine) > 1

      candidates.push({
        id: `${relativePath}:${idx + 1}:${mutation.mutation}`,
        sourceFile: relativePath,
        lineNumber: idx + 1,
        mutation: mutation.mutation,
        ambiguousForLegacy,
        originalLine: line,
        mutatedLine: mutation.mutatedLine,
        originalContent: raw,
        mutatedContent,
      })
    }
  }

  if (candidates.length === 0) {
    throw new Error("Unable to build correctness fixtures from repository files")
  }

  const shuffled = seededShuffle(candidates, seed)
  const ambiguous = shuffled.filter((fixture) => fixture.ambiguousForLegacy)
  const nonAmbiguous = shuffled.filter((fixture) => !fixture.ambiguousForLegacy)

  const ambiguousTarget = Math.min(Math.floor(targetCount * 0.4), ambiguous.length)
  const picked = [...ambiguous.slice(0, ambiguousTarget)]
  const pickedIds = new Set(picked.map((fixture) => fixture.id))

  for (const fixture of nonAmbiguous) {
    if (picked.length >= targetCount) {
      break
    }
    picked.push(fixture)
    pickedIds.add(fixture.id)
  }

  if (picked.length < targetCount) {
    for (const fixture of shuffled) {
      if (picked.length >= targetCount) {
        break
      }
      if (pickedIds.has(fixture.id)) {
        continue
      }
      picked.push(fixture)
      pickedIds.add(fixture.id)
    }
  }

  return seededShuffle(picked, seed ^ 0x9e3779b9)
}

async function readRefContext(workspace, filePath, lineNumber) {
  const output = await runHashlineRead({
    filePath,
    context: { directory: workspace },
  })

  return {
    output,
    fileRev: extractFileRev(output),
    ref: extractRef(output, lineNumber),
  }
}

async function applyHashlineStrategy(workspace, filePath, fixture) {
  try {
    const context = await readRefContext(workspace, filePath, fixture.lineNumber)
    if (!context.ref || !context.fileRev) {
      return { ok: false, reason: "MISSING_HASHLINE_REF" }
    }

    await runHashlineOperations({
      filePath,
      fileRev: context.fileRev,
      operations: [
        {
          op: "replace",
          ref: context.ref,
          content: fixture.originalLine,
        },
      ],
      context: { directory: workspace },
    })

    return { ok: true }
  } catch (error) {
    return { ok: false, reason: classifyError(error) }
  }
}

async function applyPatchJsonStrategy(workspace, filePath, fixture) {
  try {
    const context = await readRefContext(workspace, filePath, fixture.lineNumber)
    if (!context.ref || !context.fileRev) {
      return { ok: false, reason: "MISSING_HASHLINE_REF" }
    }

    const patchPayload = JSON.stringify({
      filePath: filePath,
      fileRev: context.fileRev,
      operations: [
        {
          op: "replace",
          ref: context.ref,
          content: fixture.originalLine,
        },
      ],
    })

    const parsedPatch = parsePatchText(patchPayload)
    const operations = (parsedPatch.operations ?? []).map((operation) => mapOperationInput(operation))
    if (operations.length === 0) {
      return { ok: false, reason: "EMPTY_PATCH_OPERATIONS" }
    }

    await runHashlineOperations({
      filePath: parsedPatch.filePath ?? filePath,
      operations,
      expectedFileHash: parsedPatch.expectedFileHash,
      fileRev: parsedPatch.fileRev,
      context: { directory: workspace },
    })

    return { ok: true }
  } catch (error) {
    return { ok: false, reason: classifyError(error) }
  }
}

async function runPerformanceBenchmark() {
  const { tempDir, formatWithHashline } = await loadFormatWithHashline()

  console.log(`Performance benchmark (iterations=${PERF_ITERATIONS})`)

  try {
    timeSync("formatWithHashline(sample)", PERF_ITERATIONS, () => {
      formatWithHashline(SAMPLE)
    })

    await timeAsync("runHashlineRead(README.md)", PERF_ITERATIONS, async () => {
      await runHashlineRead({ filePath: "README.md", context: { directory: PROJECT_ROOT } })
    })

    const readOutput = await runHashlineRead({ filePath: "README.md", context: { directory: PROJECT_ROOT } })
    const readRev = extractFileRev(readOutput)
    const firstRef = extractRef(readOutput, 1)
    const firstLine = readOutput.match(/^#HL\s+1#[A-Z0-9]+#[A-Z0-9]+\|(.*)$/m)?.[1] ?? "# Hashline toolset for OpenCode"

    if (readRev && firstRef) {
      await timeAsync("runHashlineOperations(dryRun)", PERF_ITERATIONS, async () => {
        await runHashlineOperations({
          filePath: "README.md",
          fileRev: readRev,
          dryRun: true,
          operations: [{ op: "replace", ref: firstRef, content: firstLine }],
          context: { directory: PROJECT_ROOT },
        })
      })

      timeSync("parsePatchText(payload)", PERF_ITERATIONS, () => {
        parsePatchText(
          JSON.stringify({
            filePath: "README.md",
            fileRev: readRev,
            operations: [{ op: "replace", ref: firstRef, content: firstLine }],
          }),
        )
      })
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

async function runCorrectnessBenchmark() {
  const fixtures = await buildFixtures(PROJECT_ROOT, CORRECTNESS_FIXTURES, BENCH_SEED)

  const strategies = [
    { name: "hashline_ops", run: applyHashlineStrategy },
    { name: "hashline_patch_json", run: applyPatchJsonStrategy },
  ]

  const totalTasks = fixtures.length * CORRECTNESS_RUNS

  console.log("")
  console.log(
    `Correctness benchmark (fixtures=${fixtures.length}, runs=${CORRECTNESS_RUNS}, tasks=${totalTasks})`,
  )

  const rows = []
  for (const strategy of strategies) {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `hashline-correctness-${strategy.name}-`))
    const failureReasons = new Map()

    let pass = 0
    let fail = 0
    const startedAt = performance.now()

    try {
      for (let runIdx = 0; runIdx < CORRECTNESS_RUNS; runIdx += 1) {
        for (let taskIdx = 0; taskIdx < fixtures.length; taskIdx += 1) {
          const fixture = fixtures[taskIdx]
          const targetRelative = path.join("cases", `run-${runIdx + 1}`, `task-${taskIdx + 1}`, path.basename(fixture.sourceFile))
          const targetAbsolute = path.join(workspace, targetRelative)

          await fs.mkdir(path.dirname(targetAbsolute), { recursive: true })
          await fs.writeFile(targetAbsolute, fixture.mutatedContent, "utf8")

          const result = await strategy.run(workspace, targetRelative, fixture)
          const finalContent = await fs.readFile(targetAbsolute, "utf8")
          const contentMatches = finalContent === fixture.originalContent

          if (result.ok && contentMatches) {
            pass += 1
          } else {
            fail += 1
            incrementCount(failureReasons, result.reason ?? (contentMatches ? "UNKNOWN" : "CONTENT_MISMATCH"))
          }
        }
      }
    } finally {
      await fs.rm(workspace, { recursive: true, force: true })
    }

    const elapsedMs = performance.now() - startedAt
    rows.push({
      strategy: strategy.name,
      pass,
      fail,
      passRate: totalTasks === 0 ? 0 : (pass / totalTasks) * 100,
      avgMsPerTask: totalTasks === 0 ? 0 : elapsedMs / totalTasks,
      failureReasons,
    })
  }

  printResultsTable(rows)

  for (const row of rows) {
    const sortedFailures = [...row.failureReasons.entries()].sort((a, b) => b[1] - a[1])
    if (sortedFailures.length === 0) {
      continue
    }

    console.log("")
    console.log(`Top failures (${row.strategy}):`)
    for (const [reason, count] of sortedFailures.slice(0, 5)) {
      console.log(`- ${reason}: ${count}`)
    }
  }
}

async function main() {
  console.log(
    `Hashline benchmark (perf_iterations=${PERF_ITERATIONS}, correctness_fixtures=${CORRECTNESS_FIXTURES}, correctness_runs=${CORRECTNESS_RUNS}, seed=${BENCH_SEED})`,
  )
  console.log("")

  await runPerformanceBenchmark()
  await runCorrectnessBenchmark()
}

await main()
