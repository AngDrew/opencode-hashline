import test from "node:test"
import assert from "node:assert/strict"

import { HashlineRouting } from "../../dist/.opencode/plugins/hashline-routing.js"

test("read normalizes path to filePath", async () => {
  const plugin = await HashlineRouting({ directory: process.cwd() } as any)
  const before = plugin["tool.execute.before"]

  assert.equal(typeof before, "function")

  const output: any = { args: { path: "src/file.ts" } }

  await before?.({ tool: "read" } as never, output as never)

  assert.equal(output.args.filePath, "src/file.ts")
})
