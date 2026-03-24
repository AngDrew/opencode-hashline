import test from "node:test"
import assert from "node:assert/strict"

import { createHashlineHooks } from "../../dist/.opencode/plugins/hashline-hooks.js"

const config = {
  exclude: [],
  maxFileSize: 1_048_576,
  cacheSize: 16,
  prefix: ";;;",
  fileRev: true,
  safeReapply: false,
}

function makeHooks() {
  return createHashlineHooks(config)
}

async function runSystemTransform(system) {
  const hooks = makeHooks()
  const output = { system: [...system] }
  const transform = hooks["experimental.chat.system.transform"]

  if (!transform) {
    throw new Error("Missing system transform hook")
  }

  await transform({ model: {} as any }, output)

  return output.system
}

test("system instruction transform is idempotent", async () => {
  const hooks = makeHooks()
  const output = { system: ["bootstrap"] }
  const transform = hooks["experimental.chat.system.transform"]

  if (!transform) {
    throw new Error("Missing system transform hook")
  }

  await transform({ model: {} as any }, output)
  const afterFirst = [...output.system]

  await transform({ model: {} as any }, output)

  assert.deepEqual(output.system, afterFirst)
  assert.equal(
    output.system.filter((entry) => entry.includes("hashline-instruction-v1")).length,
    1,
  )
})

test("old instruction markers are cleaned up", async () => {
  const oldInstruction = [
    "<!-- hashline-instruction-v0 -->",
    "legacy guidance",
    "<!-- /hashline-instruction-v0 -->",
  ].join("\n")

  const system = await runSystemTransform(["intro", oldInstruction, "outro"])

  assert.equal(system.some((entry) => /hashline-instruction-v0/i.test(entry)), false)
  assert.equal(system.filter((entry) => entry.includes("hashline-instruction-v1")).length, 1)
  assert.equal(system[0], "intro")
  assert.equal(system[system.length - 1], "outro")
})

test("instruction is injected when missing", async () => {
  const system = await runSystemTransform(["intro", "outro"])

  assert.equal(system.filter((entry) => entry.includes("hashline-instruction-v1")).length, 1)
  assert.equal(system.length, 3)
  assert.equal(system[0], "intro")
  assert.equal(system[1], "outro")
  assert.equal(system[2].includes("hashline-instruction-v1"), true)
})
