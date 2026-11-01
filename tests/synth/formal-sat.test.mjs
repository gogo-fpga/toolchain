import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runSatFormal } from "../../web/lib/formal-sat.mjs";
import { createMemoryTree, runWasiP1, treeToObject } from "../../web/lib/wasi-p1.mjs";
import { assertYosysCreator } from "./yosys-parity.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const nativePath = path.join(root, "build/native/yosys");
const wasmPath = path.join(root, "build/wasi/yosys/yosys.wasm");
const wasm = new WebAssembly.Module(readFileSync(wasmPath));
mkdirSync(path.join(root, "build/S15"), { recursive: true });
const evidence = mkdtempSync(path.join(root, "build/S15/p1-sat-"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
writeFileSync(path.join(evidence, "manifest.json"), JSON.stringify({
  revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  workingTree: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }),
  node: process.version,
  nativeVersion: execFileSync(nativePath, ["-V"], { encoding: "utf8" }).trim(),
  nativeSha256: hash(readFileSync(nativePath)), wasmSha256: hash(readFileSync(wasmPath)),
}, null, 2));
console.log(`Retained formal SAT evidence: ${evidence}`);

function executors(name, source) {
  const directory = path.join(evidence, name);
  mkdirSync(directory);
  const nativeDir = path.join(directory, "native");
  mkdirSync(nativeDir);
  mkdirSync(path.join(nativeDir, "__formal"));
  writeFileSync(path.join(nativeDir, "top.v"), source);
  const workspace = createMemoryTree({ "top.v": source, __formal: {}, tmp: {} });
  function save(phase, result) {
    writeFileSync(path.join(directory, `${phase}.stdout`), result.stdout);
    writeFileSync(path.join(directory, `${phase}.stderr`), result.stderr);
    for (const name of ["before.json", "after.json"]) {
      const bytes = result.files.get(`__formal/${name}`);
      if (bytes) assertYosysCreator(JSON.parse(new TextDecoder().decode(bytes)).creator);
    }
    return result;
  }
  return {
    native: async ({ phase, script }) => {
      writeFileSync(path.join(directory, `native-${phase}.ys`), script);
      const result = spawnSync(nativePath, ["-Q", "-T", "-p", script], {
        cwd: nativeDir, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
      });
      assert.ifError(result.error);
      return save(`native-${phase}`, {
        exitCode: result.status, stdout: result.stdout, stderr: result.stderr,
        files: new Map(readdirSync(path.join(nativeDir, "__formal")).map((filename) =>
          [`__formal/${filename}`, readFileSync(path.join(nativeDir, "__formal", filename))])),
      });
    },
    wasm: async ({ phase, script }) => {
      writeFileSync(path.join(directory, `wasm-${phase}.ys`), script);
      const stdout = [];
      const stderr = [];
      const result = runWasiP1(wasm, {
        args: ["yosys", "-Q", "-T", "-p", script], env: { TMPDIR: "/tmp" },
        preopens: { "/": workspace, "/tmp": workspace.entries.get("tmp") },
        stdout: (bytes) => stdout.push(bytes), stderr: (bytes) => stderr.push(bytes),
      });
      const files = new Map(Object.entries(treeToObject(workspace).__formal).map(([filename, bytes]) => {
        writeFileSync(path.join(directory, `wasm-${filename}`), bytes);
        return [`__formal/${filename}`, bytes];
      }));
      return save(`wasm-${phase}`, {
        ...result, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), files,
      });
    },
  };
}

const combinational = (property) => `module top(input [3:0] a, output [3:0] y);
  assign y = ~a;
  always @* begin P_ID: assert (${property}); end
endmodule`;
const counter = `module top(input clk, output reg [3:0] q = 0);
  always @(posedge clk) q <= q + 1'b1;
  always @* begin P_BOUND: assert (q < 4'd3); end
endmodule`;
const invariant = `module top(input clk, output reg [3:0] x = 0, output reg [3:0] y = 0);
  always @(posedge clk) begin x <= x + 1'b1; y <= y + 1'b1; end
  always @* begin P_SAME: assert(x == y); end
endmodule`;

for (const scenario of [
  { name: "identity", source: combinational("(a ^ y) == 4'hf"), expected: "bounded-safe" },
  { name: "broken-identity", source: combinational("(a ^ y) == 4'h0"), expected: "counterexample" },
  { name: "depth3", source: counter, depth: 3, clock: "clk", expected: "bounded-safe" },
  { name: "depth4", source: counter, depth: 4, clock: "clk", expected: "counterexample" },
  { name: "depth5", source: counter, depth: 5, clock: "clk", expected: "counterexample" },
  { name: "induction", source: invariant, clock: "clk", mode: "prove", expected: "proved" },
  { name: "false-induction", source: counter, clock: "clk", mode: "prove", expected: "counterexample" },
  { name: "contradictory-assumes", source: `module top(input a); always @* begin
    A: assume(a); B: assume(!a); P: assert(a); end endmodule`, expected: "inconsistent-assumptions" },
  { name: "zero-properties", source: "module top(input a, output y); assign y=a; endmodule", expected: "error" },
  { name: "wrong-clock", source: counter, clock: "missing", expected: "error" },
  { name: "wrong-edge", source: counter, clock: "clk", edge: "negedge", expected: "error" },
  { name: "unsupported-syntax", source: "module top(input clk); assert property (@(posedge clk) 1); endmodule", expected: "error" },
]) {
  test(`formal native/WASI ${scenario.name}`, async () => {
    const execute = executors(scenario.name, scenario.source);
    const results = [];
    for (const runtime of ["native", "wasm"]) {
      const result = await runSatFormal({ sources: ["top.v"], top: "top", depth: 8, ...scenario, execute: execute[runtime] });
      writeFileSync(path.join(evidence, scenario.name, `${runtime}-result.json`), JSON.stringify({
        ...result, observations: result.observations.map(({ files, ...observation }) => ({
          ...observation, files: [...files.keys()],
        })),
      }, null, 2));
      assert.equal(result.status, scenario.expected, `${runtime}: ${result.message ?? ""}`);
      if (result.status === "counterexample") assert.equal(result.replay, "pending");
      results.push(result);
    }
    assert.deepEqual(results[0].inventory, results[1].inventory);
    assert.equal(results[0].status, results[1].status);
  });
}
