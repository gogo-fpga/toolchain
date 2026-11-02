import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runGhdlSynth } from "../../web/lib/ghdl-host.mjs";
import { runSatFormal } from "../../web/lib/formal-sat.mjs";
import { createFormalExecutors } from "./formal-helpers.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const build = path.resolve(root, process.env.GHDL_WASM_BUILD_ROOT ?? "build");
const native = path.join(build, "ghdl-native/bin/ghdl");
const wasmPath = path.join(build, "ghdl-wasm/ghdl-synth.wasm");
const wasm = new WebAssembly.Module(readFileSync(wasmPath));
function loadTree(directory) {
  return Object.fromEntries(readdirSync(directory).map((name) => {
    const file = path.join(directory, name);
    return [name, statSync(file).isDirectory() ? loadTree(file) : new Uint8Array(readFileSync(file))];
  }));
}
const librariesTree = loadTree(path.join(build, "ghdl-native/lib/ghdl"));
mkdirSync(path.join(root, "build/S15"), { recursive: true });
const evidence = mkdtempSync(path.join(root, "build/S15/p1-vhdl-"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = readFileSync(path.join(build, "ghdl-wasm/build-manifest.tsv"), "utf8");
const metadata = Object.fromEntries(manifest.trim().split("\n").map((row) => row.split("\t")));
assert.equal(hash(readFileSync(native)), metadata.native_sha256);
for (const input of ["patches/ghdl/formal-verilog.patch", "patches/ghdl/formal-verilog-driver.patch", "scripts/ghdl-wasm/synth_api.ads", "scripts/ghdl-wasm/synth_api.adb"]) {
  assert.equal(hash(readFileSync(path.join(root, input))), metadata[`source_sha256:${input}`]);
}
const checksums = readFileSync(path.join(build, "ghdl-wasm/SHA256SUMS"), "utf8");
assert.equal(checksums.split(/\s+/)[0], hash(readFileSync(wasmPath)));
writeFileSync(path.join(evidence, "manifest.json"), JSON.stringify({
  revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  workingTree: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }),
  node: process.version, nativeVersion: execFileSync(native, ["--version"], { encoding: "utf8" }),
  nativeSha256: hash(readFileSync(native)), wasmSha256: hash(readFileSync(wasmPath)), buildManifest: metadata,
}, null, 2));
console.log(`Retained VHDL formal evidence: ${evidence}`);

const counter = (property, edge = "rising_edge") => `library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;
entity top is
  port (clk, a : in std_logic; q : out unsigned(3 downto 0));
end entity;
architecture rtl of top is
  signal count : unsigned(3 downto 0) := (others => '0');
begin
  process(clk) begin
    if ${edge}(clk) then count <= count + 1; end if;
  end process;
  q <= count;
${property}
end architecture;
`;
const plain = counter("  P_BOUND: assert count < 3;");
const psl = counter(`  -- psl default clock is rising_edge(clk);
  -- psl P_BOUND: assert always (count < 3);
  -- psl A_INPUT: assume always (a = '0');
  -- psl C_REACH: cover {count = 2};`);
const rows = ["case,frontend,runtime,expected,actual,assertions,assumptions,covers,sourceSha256,verilogSha256,inventorySha256"];
function saveResult(filename, result) {
  writeFileSync(filename, JSON.stringify({ ...result, observations: result.observations.map(({ files, ...observation }) => ({
    ...observation, files: [...files.keys()],
  })) }, null, 2));
}
function lower(name, source, { formal = true, psl = false } = {}) {
  const directory = path.join(evidence, name);
  mkdirSync(directory);
  writeFileSync(path.join(directory, "top.vhd"), source);
  const flags = ["--std=08", ...(psl ? ["-fpsl"] : [])];
  const analyze = spawnSync(native, ["-a", ...flags, "top.vhd"], {
    cwd: directory, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
  });
  writeFileSync(path.join(directory, "analyze.stdout"), analyze.stdout ?? "");
  writeFileSync(path.join(directory, "analyze.stderr"), analyze.stderr ?? "");
  assert.ifError(analyze.error);
  assert.equal(analyze.status, 0, analyze.stderr);
  const compiled = spawnSync(native, ["--synth", ...flags, "--out=verilog", ...(formal ? ["--formal-verilog"] : []), "top"], {
    cwd: directory, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(compiled.error);
  writeFileSync(path.join(directory, "native.stdout"), compiled.stdout);
  writeFileSync(path.join(directory, "native.stderr"), compiled.stderr);
  const result = runGhdlSynth({ module: wasm, librariesTree, files: [{ path: "top.vhd", content: new TextEncoder().encode(source) }], top: "top", formal, psl });
  writeFileSync(path.join(directory, "wasm.v"), result.verilog);
  writeFileSync(path.join(directory, "wasm.log"), result.log);
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.equal(result.status, 0, result.log);
  assert.equal(result.verilog, compiled.stdout);
  return { native: compiled.stdout, wasm: result.verilog };
}

for (const scenario of [
  { name: "plain-depth3", source: plain, depth: 3, expected: "bounded-safe" },
  { name: "plain-depth4", source: plain, depth: 4, expected: "counterexample" },
  { name: "plain-depth5", source: plain, depth: 5, expected: "counterexample" },
  { name: "plain-negedge", source: counter("  P_BOUND: assert count < 3;", "falling_edge"), depth: 4, edge: "negedge", expected: "counterexample" },
  { name: "plain-prove", source: plain, depth: 12, mode: "prove", expected: "counterexample" },
  { name: "psl-depth3", source: psl, depth: 3, psl: true, expected: "bounded-safe" },
  { name: "psl-depth4", source: psl, depth: 4, psl: true, expected: "counterexample" },
  { name: "psl-depth5", source: psl, depth: 5, psl: true, expected: "counterexample" },
  { name: "psl-activation", source: counter(`  -- psl default clock is rising_edge(clk);
  -- psl P_BOUND: assert always (a = '1' -> next (count < 3));`), depth: 6, psl: true, expected: "counterexample", covers: 1, assumes: 0 },
  { name: "psl-off", source: psl, depth: 5, expected: "error" },
  { name: "psl-inconsistent", source: counter(`  -- psl default clock is rising_edge(clk);
  -- psl A_ONE: assume always (a = '1');
  -- psl A_ZERO: assume always (a = '0');
  -- psl P_BOUND: assert always (count < 3);`), depth: 5, psl: true, expected: "inconsistent-assumptions", covers: 0, assumes: 2 },
]) {
  test(`VHDL property native/WASM ${scenario.name}`, async () => {
    const lowered = lower(scenario.name, scenario.source, { psl: scenario.psl });
    let baseline;
    for (const frontend of ["native", "wasm"]) {
      const execute = createFormalExecutors(evidence, `${scenario.name}-${frontend}`, lowered[frontend]);
      for (const runtime of ["native", "wasm"]) {
        const result = await runSatFormal({ sources: ["top.v"], top: "top", clock: "clk", internalCells: true, ...scenario, execute: execute[runtime] });
        saveResult(path.join(evidence, `${scenario.name}-${frontend}`, `${runtime}-result.json`), result);
        assert.equal(result.status, scenario.expected, `${frontend}/${runtime}: ${result.message}`);
        if (result.inventory) {
          assert.equal(result.inventory.counts.assert, 1);
          if (!baseline) baseline = result.inventory;
          assert.deepEqual(result.inventory, baseline);
          assert.ok(result.inventory.properties.some(({ id, kind, source }) =>
            id === "p_bound" && kind === "assert" && /^top\.vhd:\d+\.\d+-\d+\.\d+$/.test(source)));
          const line = scenario.source.split("\n").findIndex((line) => line.includes("P_BOUND:")) + 1;
          assert.match(result.inventory.properties.find(({ id }) => id === "p_bound").source, new RegExp(`^top\\.vhd:${line}\\.`));
          if (scenario.psl) {
            assert.equal(result.inventory.counts.cover, scenario.covers ?? 1);
            assert.equal(result.inventory.counts.assume, scenario.assumes ?? 1);
            if (scenario.name === "psl-activation") {
              assert.ok(result.inventory.properties.some(({ id, kind }) => id === "p_bound_cover" && kind === "cover"));
            }
          }
          if (result.status === "counterexample") assert.equal(result.replay, "pending");
        }
        rows.push([scenario.name, frontend, runtime, scenario.expected, result.status,
          ...["assert", "assume", "cover"].map((kind) => result.inventory?.counts[kind] ?? ""),
          hash(scenario.source), hash(lowered[frontend]), hash(JSON.stringify(result.inventory)),
        ].join(","));
        writeFileSync(path.join(evidence, "results.csv"), `${rows.join("\n")}\n`);
      }
    }
  });
}

test("ordinary GHDL output is opt-out and retains the original assertion diagnostic", () => {
  const result = lower("ordinary", plain, { formal: false });
  assert.match(result.wasm, /\$fatal/);
  assert.doesNotMatch(result.wasm, /\\\$(?:assert|assume|cover)/);
});

test("the actual GHDL module remains compatible without its formal export", () => {
  const bytes = Buffer.from(readFileSync(wasmPath));
  const name = "synth_api__synth_set_formal";
  const position = bytes.indexOf(name);
  assert.ok(position > 0);
  bytes.write("synth_api__synth_set_formaX", position, "ascii");
  const module = new WebAssembly.Module(bytes);
  assert.equal(WebAssembly.Module.exports(module).some((entry) => entry.name === name), false);
  const options = { module, librariesTree, files: [{ path: "top.vhd", content: new TextEncoder().encode(plain) }], top: "top" };
  assert.equal(runGhdlSynth(options).status, 0);
  for (const psl of [false, true]) {
    const result = runGhdlSynth({ ...options, formal: true, psl });
    assert.notEqual(result.status, 0);
    assert.equal(result.stage, "init");
    assert.equal(result.verilog, "");
  }
});

test("malformed PSL fails analysis instead of dropping its property", () => {
  const source = counter(`  -- psl default clock is rising_edge(clk);
  -- psl P_BROKEN: assert always (count < );`);
  const result = runGhdlSynth({ module: wasm, librariesTree, files: [{ path: "broken.vhd", content: new TextEncoder().encode(source) }], top: "top", formal: true, psl: true });
  writeFileSync(path.join(evidence, "malformed-psl.log"), result.log);
  assert.notEqual(result.status, 0);
  assert.equal(result.stage, "analyze");
  assert.equal(result.verilog, "");
  assert.match(result.log, /broken\.vhd:\d+:\d+:/);
});
