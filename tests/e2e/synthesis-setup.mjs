import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { BOARDS } from "../../web/lib/boards.mjs";
import { createBlinkTemplate } from "../../web/lib/templates.mjs";
import { fsIdcode, fsIdcodeMatchesBoard } from "../../web/lib/fs-idcode.mjs";
import {
  createWorkdir,
  pnrArgs,
  runWasi,
  runYosysWasi,
  root,
} from "../synth/nextpnr-helpers.mjs";

export default async function globalSetup() {
  const outputDirectory = path.join(root, "build/e2e-expected");
  mkdirSync(outputDirectory, { recursive: true });
  const packer = path.join(root, "build/deps/apycula-venv/bin/gowin_pack");
  for (const board of BOARDS) {
    const workdir = createWorkdir(`s4-e2e-${board.id}-`);
    try {
      const template = createBlinkTemplate(board.id, "verilog");
      runYosysWasi(workdir, template.files.get("src/top.v"));
      writeFileSync(
        path.join(workdir, `constraints/board.cst`),
        template.files.get(`constraints/${board.id}.cst`),
      );
      const pnr = runWasi(workdir, pnrArgs(board));
      assert.equal(pnr.status, 0, `WASI nextpnr failed for ${board.id}:\n${pnr.stderr}`);
      const routed = readFileSync(path.join(workdir, "pnr.json"));
      writeFileSync(path.join(workdir, "top.json"), routed);
      const destination = path.join(outputDirectory, `${board.id}.fs`);
      const packed = spawnSync(
        packer,
        ["-d", board.packDevice, "-o", destination, "top.json"],
        { cwd: workdir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      );
      assert.equal(
        packed.status,
        0,
        `Native gowin_pack failed for ${board.id}:\n${packed.stderr ?? ""}`,
      );
      const fsText = readFileSync(destination, "utf8");
      const idcode = fsIdcode(fsText);
      assert.ok(fsIdcodeMatchesBoard(idcode, board), `Expected IDCODE mismatch for ${board.id}`);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }
}
