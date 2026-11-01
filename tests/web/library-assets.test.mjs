import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { devNull } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("the pinned library asset builder passes its hermetic regression suite", () => {
  const result = spawnSync("python3", [
    "-m", "unittest", "discover", "-s", "tests/check-library-assets", "-p", "test_*.py", "-v",
  ], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    encoding: "utf-8",
    timeout: 30_000,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "",
      GIT_AUTHOR_EMAIL: "",
      GIT_COMMITTER_NAME: "",
      GIT_COMMITTER_EMAIL: "",
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`);
});
