import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createBlinkTemplate } from "../../web/lib/templates.mjs";
import {
  createMemoryTree,
  runWasiP1,
} from "../../web/lib/wasi-p1.mjs";
import { runIverilog } from "../../web/lib/iverilog-host.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repo, "tests/fixtures/iverilog");
const wasmDir = path.resolve(process.env.IVERILOG_WASM_DIR ?? "build/iverilog-wasm/output");
const nativeDir = path.resolve(process.env.IVERILOG_NATIVE_DIR ?? "build/iverilog-native/output");
const fixtures = [
  "counter",
  "combinational",
  "fsm",
  "include_define",
  "readmemh",
  "generate",
  "finish",
];

function loadModules(directory, suffix) {
  const load = (name) => new WebAssembly.Module(readFileSync(path.join(directory, `${name}${suffix}`)));
  return { ivlpp: load("ivlpp"), ivl: load("ivl"), vvp: load("vvp") };
}

const modules = loadModules(wasmDir, ".wasm");
const nativeTools = Object.fromEntries(
  ["ivlpp", "ivl", "vvp"].map((name) => [name, path.join(nativeDir, name)]),
);
for (const toolPath of Object.values(nativeTools)) {
  if (!existsSync(toolPath)) throw new Error(`Native Icarus tool is missing: ${toolPath}`);
}

function filesFor(name, boardId) {
  if (boardId) {
    const template = createBlinkTemplate(boardId, "verilog");
    return [
      { path: "src/top.v", content: template.files.get("src/top.v") },
      {
        path: "src/testbench.v",
        content: [
          "`timescale 1ns/1ps",
          "module tb;",
          "  reg clk = 0;",
          "  wire led;",
          "  top dut(.clk(clk), .led(led));",
          "  always #5 clk = ~clk;",
          "  initial begin",
          '    $dumpfile("wave.vcd");',
          "    $dumpvars(0, tb);",
          "    repeat (4) begin",
          "      @(posedge clk);",
          '      $display("led=%0b", led);',
          "    end",
          "    $finish;",
          "  end",
          "endmodule",
          "",
        ].join("\n"),
      },
    ];
  }
  const files = [{
    path: `src/${name}.v`,
    content: readFileSync(path.join(fixtureDir, `${name}.v`), "utf8"),
  }];
  for (const dependency of ["constants.vh", "data.hex"]) {
    const candidate = path.join(fixtureDir, dependency);
    if (existsSync(candidate)) {
      files.push({ path: `src/${dependency}`, content: readFileSync(candidate) });
    }
  }
  return files;
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, SOURCE_DATE_EPOCH: "0", TZ: "UTC" },
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runNative(name, boardId) {
  const root = mkdtempSync(path.join(os.tmpdir(), "iverilog-native-"));
  try {
    const files = filesFor(name, boardId);
    const top = boardId ? "tb" : "top";
    const sourceFiles = files
      .filter((file) => file.path.endsWith(".v"))
      .map((file) => `work/${file.path}`);
    for (const file of files) {
      const target = path.join(root, "work", file.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    writeFileSync(path.join(root, "work/ivlpp.flags"), "I:work/src\n");
    writeFileSync(
      path.join(root, "work/ivl.conf"),
      [
        "module:system",
        "flag:DLL=vvp.tgt",
        "flag:VVP_EXECUTABLE=vvp",
        "functor:cprop",
        "functor:nodangle",
        `root:${top}`,
        "out:work/design.vvp",
        "generation:2",
      ].join("\n"),
    );
    const preprocessed = capture(
      nativeTools.ivlpp,
      ["-F", "work/ivlpp.flags", "-L", ...sourceFiles],
      root,
    );
    if (preprocessed.status !== 0) return { ...preprocessed, vcd: null };
    writeFileSync(path.join(root, "work/preprocessed.v"), preprocessed.stdout);
    const compiled = capture(nativeTools.ivl, ["-C", "work/ivl.conf", "work/preprocessed.v"], root);
    if (compiled.status !== 0) return { ...compiled, vcd: null };
    const simulated = capture(nativeTools.vvp, ["work/design.vvp"], root);
    const vcdPath = path.join(root, "wave.vcd");
    return {
      ...simulated,
      vcd: existsSync(vcdPath) ? readFileSync(vcdPath) : null,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runWasm(name, boardId, onPollOneoff) {
  const files = filesFor(name, boardId);
  return runIverilog({
    modules,
    files,
    sourceFiles: files.filter((file) => file.path.endsWith(".v")).map((file) => file.path),
    top: boardId ? "tb" : "top",
    includeDirs: ["src"],
    onPollOneoff,
  });
}

function normalizedDiagnostic(text) {
  return text
    .replace(/(?:\/)?work\/src\//g, "src/")
    .split(/\r?\n/)
    .filter((line) => /error|fatal/i.test(line))
    .join("\n");
}

test("Icarus WASI pipeline matches native stdout and VCD", () => {
  for (const name of fixtures) {
    const native = runNative(name);
    let pollOneoffCalls = 0;
    const wasm = runWasm(name, undefined, () => {
      pollOneoffCalls += 1;
    });
    assert.equal(native.status, 0, `${name}: native failed: ${native.stderr}`);
    assert.equal(wasm.status, 0, `${name}: WASI failed: ${wasm.stderr}`);
    assert.equal(wasm.stdout, native.stdout, `${name}: stdout differs`);
    assert.equal(pollOneoffCalls, 0, `${name}: poll_oneoff is required`);
    assert.ok(native.vcd, `${name}: native VCD missing`);
    assert.ok(wasm.tree["wave.vcd"], `${name}: WASI VCD missing`);
    assert.deepEqual(Buffer.from(wasm.tree["wave.vcd"]), native.vcd, `${name}: VCD differs`);
  }
});

test("four board Verilog templates match native stdout and VCD", () => {
  for (const boardId of ["tangnano1k", "tangnano4k", "tangnano9k", "tangnano20k"]) {
    const native = runNative(null, boardId);
    let pollOneoffCalls = 0;
    const wasm = runWasm(null, boardId, () => {
      pollOneoffCalls += 1;
    });
    assert.equal(native.status, 0, `${boardId}: native failed: ${native.stderr}`);
    assert.equal(wasm.status, 0, `${boardId}: WASI failed: ${wasm.stderr}`);
    assert.doesNotMatch(
      `${native.stderr}\n${wasm.stderr}`,
      /timescale|time unit/i,
      `${boardId}: timescale warning`,
    );
    assert.equal(wasm.stdout, native.stdout, `${boardId}: stdout differs`);
    assert.equal(pollOneoffCalls, 0, `${boardId}: poll_oneoff is required`);
    assert.ok(native.vcd, `${boardId}: native VCD missing`);
    assert.ok(wasm.tree["wave.vcd"], `${boardId}: WASI VCD missing`);
    assert.deepEqual(
      Buffer.from(wasm.tree["wave.vcd"]),
      native.vcd,
      `${boardId}: VCD differs`,
    );
  }
});

test("Icarus WASI negative controls match native status and diagnostics", () => {
  for (const name of ["syntax-error", "undefined-module", "fatal"]) {
    const native = runNative(name);
    const wasm = runWasm(name);
    assert.notEqual(native.status, 0, `${name}: native unexpectedly succeeded`);
    assert.equal(wasm.status, native.status, `${name}: exit status differs`);
    assert.equal(
      normalizedDiagnostic(wasm.stderr),
      normalizedDiagnostic(native.stderr),
      `${name}: diagnostic differs`,
    );
    if (name === "syntax-error") {
      assert.match(
        wasm.stages.ivl.stderr instanceof Uint8Array
          ? new TextDecoder().decode(wasm.stages.ivl.stderr)
          : wasm.stages.ivl.stderr,
        /work\/src\/syntax-error\.v:4: syntax error/,
      );
    }
  }
});

test("WASI ivlpp rejects VHDL input with a diagnostic", () => {
  const root = createMemoryTree({
    tmp: {},
    work: {
      "input.vhd": "entity input is end entity;\n",
      "ivlpp.flags": "",
    },
  });
  const stderr = [];
  const result = runWasiP1(modules.ivlpp, {
    args: ["ivlpp", "-F", "/work/ivlpp.flags", "-L", "/work/input.vhd"],
    preopens: { "/": root, "/tmp": root.entries.get("tmp") },
    stderr: (bytes) => stderr.push(bytes),
  });
  const message = Buffer.concat(stderr.map((chunk) => Buffer.from(chunk))).toString("utf8");
  assert.notEqual(result.exitCode, 0);
  assert.match(message, /VHDL input is not supported in this build/);
});

test("corrupted Icarus WASM is rejected by the WebAssembly validator", () => {
  const bytes = readFileSync(path.join(wasmDir, "vvp.wasm"));
  bytes[0] ^= 0xff;
  assert.throws(() => new WebAssembly.Module(bytes), WebAssembly.CompileError);
});
