// Toolchain self-test for node:test on a .mts file.
import test from "node:test";
import assert from "node:assert";
import { label, SEVERITY_ORDER, sha256 } from "./typed.mts";

test("typed helpers behave the same once types are stripped", () => {
  assert.strictEqual(label({ url: "/about", line: 3 }, "warning"), "warning /about:3");
  assert.deepStrictEqual([...SEVERITY_ORDER], ["error", "warning", "info"]);
  assert.match(sha256("bpozz"), /^[0-9a-f]{64}$/);
});
