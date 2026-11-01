import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runSatFormal } from "../../web/lib/formal-sat.mjs";
import { createFormalExecutors } from "./formal-helpers.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const nativePath = path.join(root, "build/native/yosys");
const wasmPath = path.join(root, "build/wasi/yosys/yosys.wasm");
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
    const execute = createFormalExecutors(evidence, scenario.name, scenario.source);
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
