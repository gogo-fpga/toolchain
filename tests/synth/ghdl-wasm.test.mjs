// Adapted from synth-explorer/tools/ghdl-wasm/ghdl_synth_test.mjs.
// Copyright 2025 synth-explorer contributors.
// Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runGhdlSynth } from "../../web/lib/ghdl-host.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const buildRoot = path.resolve(root, process.env.GHDL_WASM_BUILD_ROOT ?? "build");
const fixtureRoot = path.join(root, "tests/fixtures/vhdl");
const wasmPath = path.join(buildRoot, "ghdl-wasm/ghdl-synth.wasm");
const libDir = path.join(buildRoot, "ghdl-native/lib/ghdl");
const nativePath = path.join(buildRoot, "ghdl-native/bin/ghdl");
const wasmModule = new WebAssembly.Module(readFileSync(wasmPath));
const librariesTree = loadLibraryTree(libDir);

assert.ok(statSync(libDir).isDirectory(), `GHDL libraries are missing: ${libDir}`);
assert.ok(statSync(nativePath).isFile(), `Native GHDL is missing: ${nativePath}`);

function loadLibraryTree(directory) {
  const tree = {};
  for (const name of readdirSync(directory)) {
    const pathname = path.join(directory, name);
    tree[name] = statSync(pathname).isDirectory()
      ? loadLibraryTree(pathname)
      : new Uint8Array(readFileSync(pathname));
  }
  return tree;
}

function fixtureFiles(names) {
  return names.map((name) => ({
    path: name,
    content: new Uint8Array(readFileSync(path.join(fixtureRoot, name))),
  }));
}

function runWasm(top, names, standard = "2008") {
  return runGhdlSynth({
    module: wasmModule,
    librariesTree,
    files: fixtureFiles(names),
    top,
    standard,
  });
}

function runNative(top, names, standard = "2008") {
  const workDir = mkdtempSync(path.join(tmpdir(), "ghdl-native-"));
  const nativeStandard = standard === "2019" ? "19" : "08";
  try {
    for (const file of fixtureFiles(names)) {
      writeFileSync(path.join(workDir, file.path), file.content);
    }
    const analyze = spawnSync(
      nativePath,
      ["-a", `--std=${nativeStandard}`, ...names],
      { cwd: workDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (analyze.status !== 0) {
      return {
        status: analyze.status ?? 1,
        output: `${analyze.stdout ?? ""}${analyze.stderr ?? ""}`,
        error: analyze.error,
      };
    }
    const synthesis = spawnSync(
      nativePath,
      ["--synth", `--std=${nativeStandard}`, "--out=verilog", top],
      { cwd: workDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    return {
      status: synthesis.status ?? 1,
      output: synthesis.stdout ?? "",
      error: synthesis.error,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function differenceSummary(expected, actual) {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  let offset = 0;
  while (
    offset < expectedBytes.length &&
    offset < actualBytes.length &&
    expectedBytes[offset] === actualBytes[offset]
  ) {
    offset += 1;
  }
  const expectedText = expectedBytes.toString("latin1");
  const actualText = actualBytes.toString("latin1");
  const snippet = (text) => JSON.stringify(text.slice(Math.max(0, offset - 24), offset + 48));
  return (
    `first byte difference at offset ${offset}; native=${expectedBytes.length} bytes ` +
    `${snippet(expectedText)}; WASM=${actualBytes.length} bytes ${snippet(actualText)}`
  );
}

const positiveFixtures = [
  { label: "combinational logic", top: "combinational", files: ["combinational.vhd"] },
  { label: "numeric_std counter", top: "counter", files: ["counter.vhd"] },
  { label: "generic entity", top: "generic_mux", files: ["generic_mux.vhd"] },
  { label: "FSM", top: "fsm", files: ["fsm.vhd"] },
  {
    label: "package dependency and entity instantiation",
    top: "package_top",
    files: ["bit_ops.vhd", "package_top.vhd"],
  },
  {
    label: "Tang Nano 20K LED blink",
    top: "top",
    files: ["tangnano20k_led_blink.vhd"],
  },
  {
    label: "VHDL-2019 named return identifier",
    top: "top",
    files: ["return_identifier_top.vhd"],
    standard: "2019",
  },
];

for (const fixture of positiveFixtures) {
  test(`GHDL WASM synthesizes ${fixture.label}`, () => {
    const standard = fixture.standard ?? "2008";
    const wasm = runWasm(fixture.top, fixture.files, standard);
    if (process.env.GHDL_WASM_TIMING_RUN) {
      console.log(
        `S9B_TIMING ${JSON.stringify({
          run: process.env.GHDL_WASM_TIMING_RUN,
          fixture: fixture.label,
          duration_ms: wasm.durationMs,
        })}`,
      );
    }
    assert.equal(
      wasm.status,
      0,
      `WASM synthesis failed at ${wasm.stage}:\n${wasm.log}`,
    );
    assert.match(wasm.verilog, new RegExp(`module\\s+${fixture.top}\\b`));

    const native = runNative(fixture.top, fixture.files, standard);
    assert.equal(native.status, 0, `Native synthesis failed:\n${native.output}\n${native.error ?? ""}`);
    assert.equal(
      wasm.verilog,
      native.output,
      `${fixture.label}: ${differenceSummary(native.output, wasm.verilog)}`,
    );
    if (process.env.GHDL_WASM_EXPORT_DIR) {
      mkdirSync(process.env.GHDL_WASM_EXPORT_DIR, { recursive: true });
      writeFileSync(
        path.join(process.env.GHDL_WASM_EXPORT_DIR, `${fixture.top}.v`),
        wasm.verilog,
        "latin1",
      );
    }
    console.log(`${fixture.label}: byte-identical`);
  });
}

for (const name of ["syntax_error.vhd", "semantic_error.vhd"]) {
  test(`GHDL WASM reports file and line for ${name}`, () => {
    const result = runWasm(name.replace(/\.vhd$/, ""), [name]);
    assert.notEqual(result.status, 0, "Invalid VHDL unexpectedly synthesized");
    assert.match(
      result.log,
      new RegExp(`${name.replaceAll(".", "\\.")}:\\d+(?::\\d+)?`),
      `No file:line diagnostic at ${result.stage}`,
    );
  });
}
