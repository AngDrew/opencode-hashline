import test from "node:test"
import assert from "node:assert/strict"

import {
  buildEditExample,
  buildReadExample,
  formatRef,
  formatRev,
  normalizeRev,
  parseRef,
} from "../../dist/.opencode/plugins/hashline-contract.js"

test("formatRef produces canonical line references", () => {
  assert.equal(formatRef(12, "a3f"), "12#A3F")
  assert.equal(formatRef(12, "a3f", "9bc"), "12#A3F#9BC")
})

test("formatRev produces uppercase REV tokens", () => {
  const rev = formatRev("1a2b3c4d")

  assert.equal(rev, "REV:1A2B3C4D")
  assert.match(rev, /^REV:[A-F0-9]{8}$/)
})

test("parseRef parses valid refs and rejects invalid refs", () => {
  assert.deepEqual(parseRef("12#a3f#9bc"), {
    lineNumber: 12,
    hash: "A3F",
    anchor: "9BC",
  })

  assert.deepEqual(parseRef("+ #HL 7#abc"), {
    lineNumber: 7,
    hash: "ABC",
    anchor: undefined,
  })

  assert.throws(() => parseRef(""), /Invalid line reference/)
  assert.throws(() => parseRef("12#not-hex"), /Invalid line reference/)
  assert.throws(() => parseRef("0#ABC"), /Invalid line number/)
})

test("normalizeRev handles hash tokens and raw hashes", () => {
  assert.equal(normalizeRev("REV:1a2b3c4d"), "1A2B3C4D")
  assert.equal(normalizeRev("1a2b3c4d"), "1A2B3C4D")
  assert.equal(normalizeRev("#HL REV:1a2b3c4d"), "1A2B3C4D")
})

test("example builders return valid structures", () => {
  assert.deepEqual(buildReadExample("src/file.ts"), {
    filePath: "src/file.ts",
    offset: 1,
    limit: 200,
  })

  assert.deepEqual(buildEditExample("src/file.ts", "12#A3F#9BC", "const value = 2"), {
    filePath: "src/file.ts",
    operations: [
      {
        op: "replace",
        ref: "12#A3F#9BC",
        content: "const value = 2",
      },
    ],
  })
})

test("formatRef and parseRef round-trip canonically", () => {
  const ref = formatRef(42, "abc", "def")
  const parsed = parseRef(ref)

  assert.equal(ref, "42#ABC#DEF")
  assert.deepEqual(parsed, {
    lineNumber: 42,
    hash: "ABC",
    anchor: "DEF",
  })
  assert.equal(formatRef(parsed.lineNumber, parsed.hash, parsed.anchor), ref)
})
