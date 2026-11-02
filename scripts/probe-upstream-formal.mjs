import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { digest, loadSolverProbe, root } from "../tests/synth/solver-protocol-helpers.mjs";
import { sbyCases, sbyConfig } from "../tests/synth/formal-sby-cases.mjs";

const codes = { PASS: 0, FAIL: 2, UNKNOWN: 4, ERROR: 16, TIMEOUT: 8, CANCELLED: 32 };

function filesBelow(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en")).flatMap(entry => {
    const name = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? filesBelow(path.join(directory, entry.name), name) : [name];
  });
}

export function classifySbyStatus(mode, status) {
  const kinds = {
    bmc: { PASS: "bounded-pass", FAIL: "counterexample" },
    prove: { PASS: "proved", FAIL: "counterexample" },
    cover: { PASS: "covered", FAIL: "unreached" },
  };
  assert.ok(Object.hasOwn(kinds, mode), "Unsupported SBY mode");
  assert.ok(Object.hasOwn(codes, status), "Unsupported SBY status");
  return kinds[mode][status] ?? { UNKNOWN: "unknown", ERROR: "tool-error", TIMEOUT: "timeout", CANCELLED: "cancelled" }[status];
}

export function readSbyStatus(text, exitCode, stdout) {
  const match = /^(PASS|FAIL|UNKNOWN|ERROR|TIMEOUT|CANCELLED) (\d+) (\d+(?:\.\d+)?)\n$/.exec(text);
  assert.ok(match && match[0] === text, "Missing or malformed upstream SBY status");
  const [, status, code, elapsed] = match;
  assert.equal(Number(code), codes[status], "Unexpected SBY status/return-code pair");
  assert.equal(exitCode, codes[status], "Process exit disagrees with SBY status");
  assert.ok(stdout.includes(`DONE (${status}, rc=${code})`), "Missing SBY termination line");
  assert.ok(Number.isFinite(Number(elapsed)));
  return status;
}

export function probeNative({ manifestFile, out }) {
  const directory = path.resolve(out);
  assert.ok(!/[\s;'"`$\\]/.test(directory), "The upstream native shell requires an unambiguous workdir");
  mkdirSync(directory);
  const probes = JSON.parse(readFileSync(manifestFile));
  const python = execFileSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();
  const pythonPath = ["vendor/click/src", "vendor/sby/sbysrc", "vendor/yosys/backends/smt2"].map(p => path.join(root, p));
  const yosys = path.join(root, "build/native/yosys");
  const sourceFiles = ["scripts/probe-upstream-formal.mjs", "tests/synth/formal-sby-cases.mjs"];
  for (const name of ["sby", "click", "yosys"]) {
    const prefix = name === "yosys" ? "vendor/yosys/backends/smt2" : name === "sby" ? "vendor/sby/sbysrc" : "vendor/click/src/click";
    sourceFiles.push(...filesBelow(path.join(root, prefix)).filter(p => p.endsWith(".py")).map(p => `${prefix}/${p}`));
  }
  const metadata = {
    format: 1, preliminary: true, runtime: "native", command: process.argv.slice(1), node: process.version,
    python: execFileSync(python, ["--version"], { encoding: "utf8" }).trim(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    worktree: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }),
    pins: execFileSync("git", ["ls-tree", "HEAD", "vendor/sby", "vendor/yosys", "vendor/click"], { cwd: root, encoding: "utf8" }),
    yosys: { sha256: digest(readFileSync(yosys)), version: execFileSync(yosys, ["-V"], { encoding: "utf8" }).trim() },
    sources: Object.fromEntries(sourceFiles.map(p => [p, digest(readFileSync(path.join(root, p)))])),
  };
  writeFileSync(path.join(directory, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
  const rows = [];
  for (const solver of ["yices2", "z3"]) {
    const probe = loadSolverProbe(probes[solver].native, solver, "native");
    const bin = path.join(directory, `${solver}-bin`);
    mkdirSync(bin);
    symlinkSync(probe.binaryPath, path.join(bin, solver === "yices2" ? "yices-smt2" : "z3"));
    writeFileSync(path.join(bin, "metadata.json"), probe.metadata);
    for (const fixture of sbyCases) {
      const working = path.join(directory, `${solver}-${fixture.name}`);
      mkdirSync(working);
      writeFileSync(path.join(working, "top.v"), fixture.source);
      writeFileSync(path.join(working, "job.sby"), sbyConfig(fixture, solver));
      const quoted = p => `'${p.replaceAll("'", "'\\''")}'`;
      const args = [path.join(root, "vendor/sby/sbysrc/sby.py"), "--yosys", yosys,
        "--smtbmc", `${quoted(python)} ${quoted(path.join(root, "vendor/yosys/backends/smt2/smtbmc.py"))}`,
        "--witness", `${quoted(python)} ${quoted(path.join(root, "vendor/yosys/backends/smt2/witness.py"))}`,
        "-j", "1", "-d", "result", "job.sby"];
      const env = { ...process.env, PYTHONPATH: pythonPath.join(path.delimiter),
        PATH: `${bin}${path.delimiter}${process.env.PATH}`, LC_ALL: "C", TZ: "UTC", MAKEFLAGS: "", PYTHONDONTWRITEBYTECODE: "1" };
      const start = performance.now();
      const result = spawnSync(python, args, { cwd: working, env, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
      const elapsedMs = performance.now() - start;
      writeFileSync(path.join(working, "stdout.log"), result.stdout ?? "");
      writeFileSync(path.join(working, "stderr.log"), result.stderr ?? "");
      const statusFile = path.join(working, "result/status");
      const statusText = existsSync(statusFile) ? readFileSync(statusFile, "utf8") : "";
      const row = { solver, case: fixture.name, mode: fixture.mode, depth: fixture.depth, expected: fixture.status,
        status: null, kind: null, exitCode: result.status, signal: result.signal, elapsedMs,
        solverSha256: probe.info.artifact.sha256, error: result.error?.message ?? null, files: {} };
      for (const name of filesBelow(working)) {
        const bytes = readFileSync(path.join(working, name));
        row.files[name] = { bytes: bytes.length, sha256: digest(bytes) };
      }
      try {
        assert.ifError(result.error);
        row.status = readSbyStatus(statusText, result.status, result.stdout);
        assert.equal(row.status, fixture.status);
        assert.match(result.stdout, /starting process/);
        if (fixture.witness) {
          assert.ok(Object.keys(row.files).some(p => /^result\/engine_0\/trace\d*\.vcd$/.test(p)), "Missing required VCD");
          assert.ok(Object.keys(row.files).some(p => /^result\/engine_0\/trace\d*\.yw$/.test(p)), "Missing required Yosys witness");
        }
        row.kind = classifySbyStatus(fixture.mode, row.status);
        assert.equal(row.kind, fixture.kind);
      } catch (error) { row.error ??= error.message; }
      rows.push(row);
      writeFileSync(path.join(working, "result.json"), JSON.stringify(row, null, 2) + "\n");
      console.log(`${solver} ${fixture.name}: ${row.status} (rc=${row.exitCode}) ${row.error ?? row.kind}`);
    }
  }
  writeFileSync(path.join(directory, "results.json"), JSON.stringify({ preliminary: true, rows }, null, 2) + "\n");
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { probes: { type: "string" }, out: { type: "string" } } });
  assert.ok(values.probes && values.out, "Use --probes MANIFEST --out NEW_DIRECTORY");
  const rows = probeNative({ manifestFile: values.probes, out: values.out });
  if (rows.some(row => row.error)) process.exitCode = 1;
}
