import assert from "node:assert/strict";
import test from "node:test";
import { validatePath, validateProject } from "../../web/lib/project.mjs";

const validProject = {
  version: 1,
  name: "blink",
  board: "tangnano9k",
  top: "top",
  files: [{ path: "src/top.v" }, { path: "src/top.vhd" }],
};

test("project schema accepts the supported shape", () => {
  assert.deepEqual(validateProject(validProject), { ok: true, errors: [] });
});

test("project schema rejects unknown keys and versions", () => {
  const unknownKey = validateProject({ ...validProject, extra: true });
  assert.equal(unknownKey.ok, false);
  assert.match(unknownKey.errors.join(" "), /未対応の項目/);

  const wrongVersion = validateProject({ ...validProject, version: 2 });
  assert.equal(wrongVersion.ok, false);
  assert.match(wrongVersion.errors.join(" "), /版は 1/);
});

test("project schema rejects unknown boards and duplicate paths", () => {
  const unknownBoard = validateProject({ ...validProject, board: "unknown" });
  assert.equal(unknownBoard.ok, false);
  assert.match(unknownBoard.errors.join(" "), /ボード/);

  const duplicate = validateProject({
    ...validProject,
    files: [{ path: "src/top.v" }, { path: "src/top.v" }],
  });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors.join(" "), /複数登録/);
});

test("validatePath accepts relative supported files", () => {
  assert.deepEqual(validatePath("src/top.v"), { ok: true, errors: [] });
  assert.deepEqual(validatePath("docs/research/oss-survey.md"), {
    ok: true,
    errors: [],
  });
});

test("validatePath rejects traversal, empty segments, drive paths, and extensions", () => {
  for (const path of ["../x.v", "a//b.v", "C:\\x.v", "/src/top.v", "src/top.bin"]) {
    assert.equal(validatePath(path).ok, false, path);
  }
});

test("validatePath enforces the path length and segment alphabet", () => {
  assert.equal(validatePath(`${"a".repeat(125)}.v`).ok, true);
  assert.equal(validatePath(`${"a".repeat(127)}.v`).ok, false);
  assert.equal(validatePath("src/名前.v").ok, false);
  assert.equal(validatePath("src/top.V").ok, false);
});
