import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("the pinned library asset builder passes its hermetic regression suite", () => {
  const result = spawnSync("python3", [
    "-m", "unittest", "discover", "-s", "tests/check-library-assets", "-p", "test_*.py", "-v",
  ], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    encoding: "utf-8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`);
});
