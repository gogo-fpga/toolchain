import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStore } from "../../web/lib/project-store.mjs";

const project = {
  version: 1,
  name: "blink",
  board: "tangnano9k",
  top: "top",
  vhdlStandard: "2008",
  files: [{ path: "src/top.v" }, { path: "build/top.fs" }],
};

test("memory project store round-trips text and binary files", async () => {
  const store = createMemoryStore();
  const bits = new Uint8Array([0, 1, 2, 255]);
  await store.save(
    project,
    new Map([
      ["src/top.v", "module top; endmodule\n"],
      ["build/top.fs", bits],
    ]),
  );

  bits[0] = 99;
  const loaded = await store.load("blink");
  assert.deepEqual(loaded.project, project);
  assert.equal(loaded.files.get("src/top.v"), "module top; endmodule\n");
  assert.deepEqual(loaded.files.get("build/top.fs"), new Uint8Array([0, 1, 2, 255]));
  assert.deepEqual(await store.listProjects(), ["blink"]);
});

test("memory project store fails closed on corrupt project.json", async () => {
  const store = createMemoryStore({
    records: new Map([["blink", { projectJson: "{", files: new Map() }]]),
  });
  await assert.rejects(store.load("blink"), /project\.json を解析できません/);
});

test("memory project store rejects content not declared in the project", async () => {
  const store = createMemoryStore();
  await assert.rejects(
    store.save(project, new Map([["src/top.v", "module top; endmodule"]])),
    /一覧とファイルの内容が一致しません/,
  );
});
