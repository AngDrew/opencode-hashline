import test from "node:test"
import assert from "node:assert/strict"

import { createHashlineHooks } from "../../dist/.opencode/plugins/hashline-hooks.js"

const config = {
  exclude: [],
  maxFileSize: 1_048_576,
  cacheSize: 16,
  prefix: "#HL",
  fileRev: true,
  safeReapply: false,
}

function makeHooks(overrides = {}) {
  return createHashlineHooks({
    ...config,
    ...overrides,
  })
}

async function runSystemTransform(system, overrides = {}) {
  const hooks = makeHooks(overrides)
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

test("instruction includes batch-first workflow guidance and config-aware prefix notes", async () => {
  const system = await runSystemTransform(["intro"], { prefix: ";;;" })
  const instruction = system[1]

  assert.match(instruction, /Hashline workflow:/)
  assert.match(instruction, /Read returns canonical refs like `#HL 12#A3F#9BC` and `#HL REV:72C4946C`/)
  assert.match(instruction, /Active helper prefix from config: ";;;"/)
  assert.match(instruction, /do not rewrite refs just to match config/i)
  assert.match(instruction, /batch same-file changes into one edit call with operations\[\]/i)
  assert.match(instruction, /Reread only when you need more context or an edit fails because refs are stale/i)
})

test("instruction handles prefix disabled", async () => {
  const system = await runSystemTransform(["intro"], { prefix: false })
  const instruction = system[1]

  assert.match(instruction, /Active helper prefix from config: none/)
  assert.match(instruction, /Read output stays canonical `#HL`/)
})

test("instruction falls back to the default prefix when config prefix is missing", async () => {
  const system = await runSystemTransform(["intro"], { prefix: undefined })
  const instruction = system[1]

  assert.match(instruction, /Active helper prefix from config: "#HL"/)
  assert.match(instruction, /Read output stays canonical `#HL`/)
})

test("tool descriptions nudge agents toward the efficient hashline workflow", async () => {
  const hooks = makeHooks()
  const definition = hooks["tool.definition"]

  if (!definition) {
    throw new Error("Missing tool definition hook")
  }

  const readOutput = { description: "native read", parameters: {} }
  await definition({ toolID: "read" } as any, readOutput as any)
  assert.match(readOutput.description, /canonical #HL refs plus a REV token/i)
  assert.match(readOutput.description, /plan all same-file changes before calling edit/i)

  const editOutput = { description: "native edit", parameters: {} }
  await definition({ toolID: "edit" } as any, editOutput as any)
  assert.match(editOutput.description, /Accepts refs copied from read/i)
  assert.match(editOutput.description, /Prefer one batched call per file/i)
  assert.match(editOutput.description, /operations:\[\{ op, ref\|startRef\/endRef, content\? \}\]/i)

  const writeOutput = { description: "native write", parameters: {} }
  await definition({ toolID: "write" } as any, writeOutput as any)
  assert.match(writeOutput.description, /Use write for new files or full rewrites/i)
  assert.match(writeOutput.description, /Prefer edit for targeted existing-file changes/i)
})

test("edit tool schema is extended with hashline fields", async () => {
  const hooks = makeHooks()
  const definition = hooks["tool.definition"]

  if (!definition) {
    throw new Error("Missing tool definition hook")
  }

  const editOutput = {
    description: "native edit",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        oldString: { type: "string" },
        newString: { type: "string" },
        replaceAll: { type: "boolean" },
      },
      required: ["filePath", "oldString", "newString"],
    },
  }

  await definition({ toolID: "edit" } as any, editOutput as any)

  const props = editOutput.parameters.properties as Record<string, any>

  // Hashline fields must be declared
  assert.ok(props.operations, "operations property must exist")
  assert.equal(props.operations.type, "array")
  assert.ok(props.operations.items, "operations.items must exist")
  assert.ok(props.operations.items.properties.op, "op property must exist in operation items")
  assert.ok(props.operations.items.properties.ref, "ref property must exist in operation items")
  assert.ok(props.operations.items.properties.startRef, "startRef property must exist in operation items")
  assert.ok(props.operations.items.properties.endRef, "endRef property must exist in operation items")
  assert.ok(props.operations.items.properties.content, "content property must exist in operation items")

  assert.ok(props.fileRev, "fileRev property must exist")
  assert.equal(props.fileRev.type, "string")

  assert.ok(props.safeReapply, "safeReapply property must exist")
  assert.equal(props.safeReapply.type, "boolean")

  // Native fields must still be present
  assert.ok(props.filePath, "filePath must still exist")
  assert.ok(props.oldString, "oldString must still exist")
  assert.ok(props.newString, "newString must still exist")
  assert.ok(props.replaceAll, "replaceAll must still exist")

  // required must no longer include oldString/newString (they conflict with hashline-style args)
  const required = editOutput.parameters.required as string[]
  assert.ok(required.includes("filePath"), "filePath must remain required")
  assert.ok(!required.includes("oldString"), "oldString must not be required")
  assert.ok(!required.includes("newString"), "newString must not be required")
})

test("edit tool schema extension is safe when parameters is empty", async () => {
  const hooks = makeHooks()
  const definition = hooks["tool.definition"]

  if (!definition) {
    throw new Error("Missing tool definition hook")
  }

  // Simulate an empty parameters object (no properties or required)
  const editOutput = { description: "native edit", parameters: {} }
  await definition({ toolID: "edit" } as any, editOutput as any)

  const params = editOutput.parameters as Record<string, any>
  assert.ok(params.properties, "properties must be created")
  assert.ok(params.properties.operations, "operations must be added even to empty params")
  assert.ok(params.properties.fileRev, "fileRev must be added even to empty params")
  assert.ok(params.properties.safeReapply, "safeReapply must be added even to empty params")
})

test("non-edit tools do not get schema modifications", async () => {
  const hooks = makeHooks()
  const definition = hooks["tool.definition"]

  if (!definition) {
    throw new Error("Missing tool definition hook")
  }

  const readOutput = { description: "native read", parameters: { properties: {}, required: [] } }
  await definition({ toolID: "read" } as any, readOutput as any)

  const readProps = readOutput.parameters.properties as Record<string, any>
  assert.equal(readProps.operations, undefined, "read tool should not get operations property")
  assert.equal(readProps.fileRev, undefined, "read tool should not get fileRev property")
})
