#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { HDL_LIBRARY_CASES } from "../tests/fixtures/libraries/cases.mjs";
import { BOARDS } from "../web/lib/boards.mjs";

const root = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({ options: {
  "matrix-dir": { type: "string" }, out: { type: "string" }, repeats: { type: "string", default: "5" },
} });
assert.ok(values["matrix-dir"] && values.out, "Required: --matrix-dir COMPLETE_MATRIX --out NEW_DIR");
const repeats = Number(values.repeats);
assert.ok(Number.isSafeInteger(repeats) && repeats >= 5, "At least five repeats are required");
const source = path.resolve(root, values["matrix-dir"]);
const out = path.resolve(root, values.out);
const load = (file) => JSON.parse(readFileSync(file, "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expected = HDL_LIBRARY_CASES.length * BOARDS.length;
const complete = load(path.join(source, "summary.json"));
assert.equal(complete.expected, expected);
assert.equal(complete.passed, expected, "The full synthesis/PNR/pack matrix must pass first");
const cases = HDL_LIBRARY_CASES.flatMap(({ id }) => BOARDS.map(({ id: board }) => {
  const directory = path.join(source, id, board);
  const measurement = load(path.join(directory, "measurement.json"));
  assert.equal(measurement.status, "passed");
  assert.equal(measurement.id, id);
  assert.equal(measurement.board, board);
  assert.equal(measurement.hashes.pnr_wasi, measurement.hashes.pnr_native);
  assert.ok(measurement.fs_bytes > 0);
  for (const value of Object.values(measurement.timings)) assert.ok(Number.isFinite(value) && value > 0);
  return { id, board, directory, resources: measurement.resources,
    layout: hash(JSON.stringify(load(path.join(directory, "pnr.json")))) };
}));
mkdirSync(out);
const rows = [];
const manifests = [];
function run(sample, phase, invalid = false) {
  const name = `${phase}-${sample.id}-${sample.board}`;
  const directory = path.join(out, name);
  const result = spawnSync(process.execPath, ["scripts/diagnose-pnr-layout.mjs", "--case-dir", sample.directory,
    "--out", directory, "--board", sample.board, "--repeats", String(repeats)], {
    cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 4 * 1024 * 1024,
  });
  writeFileSync(path.join(out, `${name}.stdout.log`), result.stdout ?? "", { flag: "wx" });
  writeFileSync(path.join(out, `${name}.stderr.log`), result.stderr ?? "", { flag: "wx" });
  assert.ifError(result.error);
  assert.equal(result.status, invalid ? 1 : 0, `${result.stderr}\n${result.stdout}`);
  const summary = load(path.join(directory, "summary.json"));
  const metadata = load(path.join(directory, "metadata.json"));
  assert.equal(summary.failed, invalid);
  assert.equal(summary.cross_backend_same, !invalid);
  assert.equal(summary.rows.length, 2 * repeats);
  if (!invalid) assert.deepEqual(summary.resources, sample.resources);
  const seen = new Set();
  for (const row of summary.rows) {
    assert.ok(["native", "wasi"].includes(row.backend));
    assert.ok(Number.isInteger(row.repeat) && row.repeat >= 1 && row.repeat <= repeats);
    const key = `${row.backend}-${row.repeat}`;
    assert.ok(!seen.has(key), `Repeated result: ${name}/${key}`);
    seen.add(key);
    assert.equal(row.status, invalid ? "failed" : "passed");
    assert.ok(Number.isFinite(row.elapsed_ms) && row.elapsed_ms > 0);
    if (invalid) {
      assert.equal(row.layout_sha256, "");
      assert.match(readFileSync(path.join(directory, key, "stderr.log"), "utf8"), /S13_UNKNOWN_CELL/);
    } else {
      assert.equal(row.layout_sha256, sample.layout);
      if (row.backend === "wasi") assert.ok(Number.isSafeInteger(row.wasi_memory_bytes) && row.wasi_memory_bytes > 0);
    }
    rows.push({ ...row, id: sample.id, board: sample.board, phase, metadata });
  }
  manifests.push({ name, metadata_sha256: hash(readFileSync(path.join(directory, "metadata.json"))),
    summary_sha256: hash(readFileSync(path.join(directory, "summary.json"))), resources: summary.resources });
  console.log(`${name}: ${invalid ? "negative control rejected" : "strict parity passed"}`);
}

const calibration = cases.find(({ id, board }) => id === "verilog-uart" && board === "tangnano1k");
assert.ok(calibration);
run(calibration, "aa1");
run(calibration, "aa2");
const negative = path.join(out, "negative-input");
mkdirSync(negative);
mkdirSync(path.join(negative, "constraints"));
const netlist = load(path.join(calibration.directory, "top.json"));
const cell = Object.values(netlist.modules.top.cells).find(({ type }) => type === "LUT4");
assert.ok(cell, "The negative control needs a retained LUT4");
cell.type = "S13_UNKNOWN_CELL";
writeFileSync(path.join(negative, "top.json"), JSON.stringify(netlist), { flag: "wx" });
writeFileSync(path.join(negative, "constraints/board.cst"), readFileSync(path.join(calibration.directory, "constraints/board.cst")), { flag: "wx" });
run({ ...calibration, directory: negative }, "negative", true);
for (const sample of cases) run(sample, "main");

const header = ["run_id", "variant", "repeat", "metric", "value", "unit", "valid", "note", "status", "library", "board",
  "layout_sha256", "wasi_memory_bytes", "LUT4_used", "LUT4_total", "DFF_used", "DFF_total", "BSRAM_used", "BSRAM_total",
  "native_binary_sha256", "wasi_binary_sha256", "netlist_sha256", "cst_sha256"];
const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = [header, ...rows.map((row) => {
  const resources = row.phase === "negative" ? {} : cases.find(({ id, board }) => id === row.id && board === row.board).resources;
  return [`${row.phase}-${row.id}-${row.board}`, row.backend, row.repeat, "pnr_elapsed", row.elapsed_ms, "ms",
    row.status === "passed", row.phase === "negative" ? "expected rejection; invalid performance sample" : "execution only; excludes module compilation",
    row.status, row.id, row.board, row.layout_sha256, row.wasi_memory_bytes,
    ...["LUT4", "DFF", "BSRAM"].flatMap((name) => [resources[name]?.used, resources[name]?.total]),
    row.metadata.hashes.native, row.metadata.hashes.wasi, row.metadata.hashes.netlist, row.metadata.hashes.cst];
})].map((row) => row.map(escape).join(",")).join("\n") + "\n";
assert.ok(Buffer.byteLength(csv) < 1024 * 1024, "The raw CSV exceeds the experiment-record limit");
writeFileSync(path.join(out, "results.csv"), csv, { flag: "wx" });
writeFileSync(path.join(out, "summary.json"), JSON.stringify({ expected, passed: cases.length, repeats,
  calibration_executions: 4 * repeats, rejected_executions: 2 * repeats, measured_executions: expected * 2 * repeats,
  script_sha256: hash(readFileSync(import.meta.filename)), csv_sha256: hash(csv), manifests }, null, 2), { flag: "wx" });
