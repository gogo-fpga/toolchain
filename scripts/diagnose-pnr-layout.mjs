#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { BOARDS } from "../web/lib/boards.mjs";
import { parseDeviceUtilization } from "../tests/synth/library-measurements.mjs";
import { nativeSharePath, nextpnrNativePath as nativePath, nextpnrWasmPath as wasmPath, pnrArgs, runNative, runWasi, wasiSharePath } from "../tests/synth/nextpnr-helpers.mjs";

const root = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({ options: {
  "case-dir": { type: "string" }, out: { type: "string" }, board: { type: "string" },
  repeats: { type: "string", default: "5" }, "native-binary": { type: "string" }, "wasm-binary": { type: "string" },
} });
const board = BOARDS.find((board) => board.id === values.board);
assert.ok(board && values["case-dir"] && values.out, "Required: --board BOARD --case-dir DIR --out NEW_DIR");
const repeats = Number(values.repeats);
assert.ok(Number.isSafeInteger(repeats) && repeats >= 5, "At least five repeats are required");
const source = path.resolve(root, values["case-dir"]);
const out = path.resolve(root, values.out);
const executable = values["native-binary"] ? path.resolve(root, values["native-binary"]) : nativePath;
const wasmExecutable = values["wasm-binary"] ? path.resolve(root, values["wasm-binary"]) : wasmPath;
const wasm = new WebAssembly.Module(readFileSync(wasmExecutable));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const input = readFileSync(path.join(source, "top.json"));
const cst = readFileSync(path.join(source, "constraints/board.cst"));
mkdirSync(out);
const version = spawnSync(executable, ["--version"], { encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const versionDirectory = path.join(out, "version-probe");
mkdirSync(versionDirectory);
mkdirSync(path.join(versionDirectory, "tmp"));
const wasiVersion = runWasi(versionDirectory, ["--version"], wasiSharePath, wasm);
assert.equal(wasiVersion.status, 0, `${wasiVersion.stderr}\n${wasiVersion.error ?? ""}`);
const chipdbName = `himbaechel/gowin/chipdb-${board.nextpnrFamily}.bin`;
const nativeChipdb = readFileSync(path.join(nativeSharePath, chipdbName));
const wasiChipdb = readFileSync(path.join(wasiSharePath, chipdbName));
assert.deepEqual(nativeChipdb, wasiChipdb, "Native/WASI chipdb inputs differ");
const buildInfoHash = (binary) => {
  const file = path.join(path.dirname(binary), "build-info.json");
  return existsSync(file) ? hash(readFileSync(file)) : null;
};
const metadata = {
  purpose: "Compare repeated layouts and record execution-only timings; no browser or hardware claim",
  measurement_scope: "Native process spawn plus execution; WASI instantiation plus execution, excluding module compilation. WASI memory is final exported linear memory, not host RSS. Native RSS is not measured.",
  criteria: "All executions must succeed; each backend must be self-reproducible; utilization must agree. Cross-backend identity is recorded, not assumed.",
  board: board.id, repeats, args: pnrArgs(board),
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  submodules: execFileSync("git", ["submodule", "status"], { cwd: root, encoding: "utf8" }),
  working_tree: execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }),
  diff_sha256: hash(execFileSync("git", ["diff", "HEAD"], { cwd: root })),
  os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cpus: os.cpus().length, memory_bytes: os.totalmem(), node: process.version,
  nextpnr_version: `${version.stdout}${version.stderr}`.trim(),
  wasi_nextpnr_version: `${wasiVersion.stdout}${wasiVersion.stderr}`.trim(),
  binary_bytes: { native: statSync(executable).size, wasi: statSync(wasmExecutable).size },
  native_binary: path.relative(root, executable),
  wasm_binary: path.relative(root, wasmExecutable),
  hashes: { netlist: hash(input), cst: hash(cst), native: hash(readFileSync(executable)), wasi: hash(readFileSync(wasmExecutable)),
    native_chipdb: hash(nativeChipdb), wasi_chipdb: hash(wasiChipdb),
    native_build_info: buildInfoHash(executable), wasi_build_info: buildInfoHash(wasmExecutable),
    script: hash(readFileSync(import.meta.filename)), helper: hash(readFileSync(path.join(root, "tests/synth/nextpnr-helpers.mjs"))) },
};
writeFileSync(path.join(out, "metadata.json"), JSON.stringify(metadata, null, 2), { flag: "wx" });
const rows = [];
const previous = new Map();
let resources;
let failed = false;
for (let repeat = 1; repeat <= repeats; repeat += 1) {
  const order = repeat % 2 ? ["native", "wasi"] : ["wasi", "native"];
  for (const backend of order) {
    const directory = path.join(out, `${backend}-${repeat}`);
    mkdirSync(directory);
    mkdirSync(path.join(directory, "constraints"));
    mkdirSync(path.join(directory, "tmp"));
    writeFileSync(path.join(directory, "top.json"), input, { flag: "wx" });
    writeFileSync(path.join(directory, "constraints/board.cst"), cst, { flag: "wx" });
    const native = values["native-binary"] ? (directory, args) => spawnSync(executable, args, {
      cwd: directory, encoding: "utf8", env: { ...process.env, TMPDIR: path.join(directory, "tmp") }, maxBuffer: 16 * 1024 * 1024,
    }) : runNative;
    const run = backend === "native" ? native : (directory, args) => runWasi(directory, args, wasiSharePath, wasm);
    const started = performance.now();
    const result = run(directory, pnrArgs(board));
    const elapsed = performance.now() - started;
    writeFileSync(path.join(directory, "stdout.log"), result.stdout);
    writeFileSync(path.join(directory, "stderr.log"), result.stderr);
    const row = { repeat, backend, status: "failed", layout_sha256: "", elapsed_ms: result.elapsed ?? elapsed, wasi_memory_bytes: result.memoryBytes ?? null };
    try {
      assert.equal(result.status, 0, `${result.stderr}\n${result.error ?? ""}`);
      assert.ok(Number.isFinite(row.elapsed_ms) && row.elapsed_ms > 0, "Invalid elapsed time");
      const utilization = parseDeviceUtilization(result.stderr);
      if (resources) assert.deepEqual(utilization, resources);
      resources = utilization;
      const routed = JSON.parse(readFileSync(path.join(directory, "pnr.json")));
      row.layout_sha256 = hash(JSON.stringify(routed));
      if (previous.has(backend)) assert.equal(row.layout_sha256, previous.get(backend), "Same-backend placement is not self-reproducible");
      previous.set(backend, row.layout_sha256);
      row.status = "passed";
    } catch (error) {
      row.error = error.stack ?? String(error);
      failed = true;
    }
    rows.push(row);
    writeFileSync(path.join(directory, "result.json"), JSON.stringify(row, null, 2), { flag: "wx" });
    console.log(`${repeat}/${repeats} ${backend}: ${row.status} ${row.layout_sha256}`);
  }
}
const summary = { failed, resources, cross_backend_same: previous.has("native") && previous.get("native") === previous.get("wasi"), rows };
writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2), { flag: "wx" });
writeFileSync(path.join(out, "results.csv"), "repeat,backend,status,layout_sha256,elapsed_ms,wasi_memory_bytes\n" + rows.map((row) => [row.repeat, row.backend, row.status, row.layout_sha256, row.elapsed_ms, row.wasi_memory_bytes ?? ""].join(",")).join("\n") + "\n", { flag: "wx" });
if (failed) process.exitCode = 1;
