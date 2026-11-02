import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { root, digest, loadSolverProbe } from "../tests/synth/solver-protocol-helpers.mjs";
import { startSolverProcess } from "../web/lib/solver-process.mjs";
import { nodeSolverWorker } from "../tests/web/solver-process-helpers.mjs";

globalThis.crossOriginIsolated = true;

const { values } = parseArgs({ options: {
  native: { type: "string" }, wasi: { type: "string" }, out: { type: "string" },
} });
assert.ok(values.native && values.wasi && values.out, "Required: --native --wasi --out");
const probes = [loadSolverProbe(values.native, "boolector", "native"), loadSolverProbe(values.wasi, "boolector", "wasi")];
assert.equal(probes[0].info.base_commit, probes[1].info.base_commit);
const output = path.resolve(values.out);
mkdirSync(output);
const json = (file, value) => writeFileSync(path.join(output, file), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const csv = fields => fields.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",") + "\n";
const columns = ["runtime", "case", "status", "exit_code", "signal", "elapsed_ms", "wasm_memory_bytes",
  "input_sha256", "stdout_sha256", "stderr_sha256", "binary_sha256", "build_commit", "metadata_sha256", "write_error"];
const results = path.join(output, "results.csv");
writeFileSync(results, csv(columns), { flag: "wx" });
const cases = [
  { name: "version", args: ["--version"], input: "", exit: 0 },
  { name: "help", args: ["--help"], input: "", exit: 0 },
  { name: "values-push-pop", args: ["--smt2", "-i"], exit: 10,
    input: "(set-option :produce-models true)(set-logic QF_BV)(declare-fun x () (_ BitVec 8))(assert (= x #x2a))(check-sat)(get-value (x))(push 1)(assert (= x #x2b))(check-sat)(pop 1)(check-sat)\n",
    stdout: "sat\n((x #b00101010))\nunsat\nsat\n" },
  { name: "eof", args: ["--smt2", "-i"], input: "(set-logic QF_BV)(check-sat)\n", exit: 10, stdout: "sat\n" },
  { name: "syntax", args: ["--smt2", "-i"], input: "(set-logic QF_BV)(not-a-command)\n", exit: 1 },
];
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
json("setup.json", { format: 1, purpose: "Diagnostic CLI comparison, not formal qualification", commit,
  argv: process.argv.slice(2), node: process.version, cases,
  builds: probes.map(probe => ({ ...probe.info, metadata_sha256: probe.metadataSha256 })) });

async function run(probe, fixture) {
  const started = performance.now();
  let result;
  let stdout;
  let stderr;
  let writeError = null;
  if (probe.info.runtime === "native") {
    const native = spawnSync(probe.binaryPath, fixture.args, { input: fixture.input, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    stdout = native.stdout ?? Buffer.alloc(0);
    stderr = native.stderr ?? Buffer.alloc(0);
    result = { status: native.error ? "setup-error" : native.signal ? "crashed" : "exited", exitCode: native.status,
      signal: native.signal, error: native.error?.message ?? null, memoryBytes: null };
  } else {
    const out = [];
    const err = [];
    const handle = startSolverProcess({ wasm: probe.binary, sha256: probe.info.artifact.sha256,
      args: ["boolector", ...fixture.args], capacity: 7, timeoutMs: 30000,
      onStdout: bytes => out.push(Buffer.from(bytes)), onStderr: bytes => err.push(Buffer.from(bytes)),
      workerFactory: () => nodeSolverWorker() });
    try {
      const bytes = Buffer.from(fixture.input);
      for (let offset = 0; offset < bytes.length; offset += 3) await handle.write(bytes.subarray(offset, offset + 3));
      handle.endInput();
    } catch (error) { writeError = error.message; }
    result = await handle.completion;
    stdout = Buffer.concat(out);
    stderr = Buffer.concat(err);
  }
  const row = { runtime: probe.info.runtime, case: fixture.name, status: result.status, exit_code: result.exitCode,
    signal: result.signal ?? null, elapsed_ms: performance.now() - started, wasm_memory_bytes: result.memoryBytes,
    input_sha256: digest(fixture.input), stdout_sha256: digest(stdout), stderr_sha256: digest(stderr),
    binary_sha256: probe.info.artifact.sha256, build_commit: probe.info.base_commit, metadata_sha256: probe.metadataSha256,
    write_error: writeError };
  const prefix = `${row.runtime}-${fixture.name}`;
  writeFileSync(path.join(output, `${prefix}.stdout`), stdout, { flag: "wx" });
  writeFileSync(path.join(output, `${prefix}.stderr`), stderr, { flag: "wx" });
  json(`${prefix}.json`, { ...row, result });
  appendFileSync(results, csv(columns.map(column => row[column])));
  assert.equal(result.status, "exited");
  assert.equal(result.exitCode, fixture.exit);
  assert.equal(result.signal ?? null, null);
  if (fixture.name !== "syntax") {
    assert.equal(writeError, null);
    assert.equal(stderr.length, 0);
  } else {
    assert.match(stderr.toString(), /expected command at 'not-a-command'/);
    assert.equal(stdout.length, 0);
  }
  if (fixture.stdout !== undefined) assert.equal(stdout.toString(), fixture.stdout);
  if (fixture.name === "version") assert.equal(stdout.toString().trim(), probe.info.source.version);
  if (fixture.name === "help") assert.match(stdout.toString(), /^usage: boolector /);
  return { stdout, stderr };
}

for (const fixture of cases) {
  const native = await run(probes[0], fixture);
  const wasi = await run(probes[1], fixture);
  assert.deepEqual(wasi.stdout, native.stdout);
  assert.deepEqual(wasi.stderr, native.stderr);
}
json("summary.json", { status: "pass", commit, cases: cases.length, executions: cases.length * probes.length,
  csv_sha256: digest(readFileSync(results)) });
