import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { WASI } from "node:wasi";
import { BOARDS } from "../../web/lib/boards.mjs";
import { createBlinkTemplate, generateCst, TEMPLATE_PINS } from "../../web/lib/templates.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const yosysWasmPath = path.join(root, "build/wasi/yosys/yosys.wasm");
const yosysSharePath = path.join(root, "build/wasi/yosys/share");
const nextpnrWasmPath = path.join(root, "build/wasi/nextpnr/nextpnr-himbaechel-gowin.wasm");
const nextpnrNativePath = path.join(root, "build/native/nextpnr/nextpnr-himbaechel-gowin");
const wasiSharePath = path.join(root, "build/wasi/nextpnr/share");
const nativeSharePath = path.join(root, "build/native/nextpnr/share");
const chipdbPath = path.join(wasiSharePath, "himbaechel/gowin");
const nativeChipdbPath = path.join(nativeSharePath, "himbaechel/gowin");
const boardsById = new Map(BOARDS.map((board) => [board.id, board]));
const boardIds = Object.keys(TEMPLATE_PINS);
const wasmModule = new WebAssembly.Module(readFileSync(nextpnrWasmPath));
const yosysModule = new WebAssembly.Module(readFileSync(yosysWasmPath));
const seed = "73421";

assert.ok(existsSync(yosysWasmPath), `WASI Yosys is missing: ${yosysWasmPath}`);
assert.ok(existsSync(nextpnrNativePath), `Native nextpnr is missing: ${nextpnrNativePath}`);
assert.ok(existsSync(wasiSharePath), `WASI chipdb root is missing: ${wasiSharePath}`);
assert.ok(existsSync(nativeSharePath), `Native chipdb root is missing: ${nativeSharePath}`);

function createWorkdir() {
  const workdir = mkdtempSync(path.join(os.tmpdir(), "nextpnr-test-"));
  mkdirSync(path.join(workdir, "src"));
  mkdirSync(path.join(workdir, "constraints"));
  mkdirSync(path.join(workdir, "tmp"));
  return workdir;
}

function closeDescriptor(descriptor) {
  try {
    closeSync(descriptor);
  } catch (error) {
    if (error.code !== "EBADF") {
      throw error;
    }
  }
}

function runWasi(workdir, args, sharePath = wasiSharePath, executable = wasmModule) {
  const stdoutPath = path.join(workdir, "wasi.stdout");
  const stderrPath = path.join(workdir, "wasi.stderr");
  const stdout = openSync(stdoutPath, "w");
  const stderr = openSync(stderrPath, "w");
  const wasi = new WASI({
    version: "preview1",
    args: ["nextpnr-himbaechel-gowin", ...args],
    env: { TMPDIR: "/tmp" },
    preopens: {
      "/": workdir,
      "/share": sharePath,
      "/tmp": path.join(workdir, "tmp"),
    },
    stdout,
    stderr,
    returnOnExit: true,
  });
  const started = performance.now();
  let status = 1;
  let error;
  try {
    status = wasi.start(new WebAssembly.Instance(executable, wasi.getImportObject()));
  } catch (caught) {
    error = caught;
  } finally {
    closeDescriptor(stdout);
    closeDescriptor(stderr);
  }
  return {
    status: Number.isInteger(status) ? status : 0,
    stdout: readFileSync(stdoutPath, "utf8"),
    stderr: readFileSync(stderrPath, "utf8"),
    elapsed: performance.now() - started,
    error,
  };
}

function runNative(workdir, args) {
  const started = performance.now();
  const result = spawnSync(nextpnrNativePath, args, {
    cwd: workdir,
    encoding: "utf8",
    env: { ...process.env, TMPDIR: path.join(workdir, "tmp") },
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    elapsed: performance.now() - started,
    error: result.error,
  };
}

function runYosysWasi(workdir, source) {
  writeFileSync(path.join(workdir, "src/top.v"), source);
  const stdout = openSync(path.join(workdir, "yosys.stdout"), "w");
  const stderr = openSync(path.join(workdir, "yosys.stderr"), "w");
  const wasi = new WASI({
    version: "preview1",
    args: ["yosys", "-q", "-p", "read_verilog src/top.v; synth_gowin -top top -json top.json"],
    env: { TMPDIR: "/tmp" },
    preopens: {
      "/": workdir,
      "/share": yosysSharePath,
      "/tmp": path.join(workdir, "tmp"),
    },
    stdout,
    stderr,
    returnOnExit: true,
  });
  let status = 1;
  let error;
  try {
    status = wasi.start(new WebAssembly.Instance(yosysModule, wasi.getImportObject()));
  } catch (caught) {
    error = caught;
  } finally {
    closeDescriptor(stdout);
    closeDescriptor(stderr);
  }
  const stderrText = readFileSync(path.join(workdir, "yosys.stderr"), "utf8");
  assert.equal(status, 0, `WASI Yosys synthesis failed:\n${stderrText}\n${error ?? ""}`);
  assert.ok(statSync(path.join(workdir, "top.json")).size > 0, "Yosys produced no JSON");
}

function pnrArgs(board, cstPath = "constraints/board.cst") {
  return [
    "--seed",
    seed,
    "--device",
    board.nextpnrDevice,
    "--vopt",
    `family=${board.nextpnrFamily}`,
    "--vopt",
    `cst=${cstPath}`,
    "--json",
    "top.json",
    "--write",
    "pnr.json",
  ];
}

function assertKeyOrderEqual(expected, actual, jsonPath = "$") {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) {
      assertKeyOrderEqual(expected[index], actual[index], `${jsonPath}[${index}]`);
    }
    return;
  }
  if (
    expected === null ||
    actual === null ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  ) {
    return;
  }
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  assert.deepStrictEqual(actualKeys, expectedKeys, `JSON key order differs at ${jsonPath}`);
  for (const key of expectedKeys) {
    assertKeyOrderEqual(expected[key], actual[key], `${jsonPath}.${key}`);
  }
}

function comparePnrDocuments(nativeDocument, wasiDocument) {
  assertKeyOrderEqual(nativeDocument, wasiDocument);
  assert.deepStrictEqual(nativeDocument, wasiDocument);
}

function mutateCellType(document) {
  for (const module of Object.values(document.modules ?? {})) {
    const cell = Object.values(module.cells ?? {})[0];
    if (cell) {
      cell.type = `${cell.type}_MUTATED`;
      return true;
    }
  }
  return false;
}

function assertSuccessful(result, runtime, boardId) {
  assert.equal(result.status, 0, `${runtime} P&R failed for ${boardId}:\n${result.stderr}\n${result.error ?? ""}`);
}

const chipdbNames = readdirSync(chipdbPath).filter((name) => name.endsWith(".bin")).sort();
const expectedChipdbNames = BOARDS.map((board) => `chipdb-${board.nextpnrFamily}.bin`).sort();
assert.deepStrictEqual(chipdbNames, expectedChipdbNames, "Gowin chipdb set does not match boards");
assert.deepStrictEqual(
  readdirSync(nativeChipdbPath).filter((name) => name.endsWith(".bin")).sort(),
  expectedChipdbNames,
  "Native Gowin chipdb set does not match boards",
);
for (const name of expectedChipdbNames) {
  assert.deepStrictEqual(
    readFileSync(path.join(nativeChipdbPath, name)),
    readFileSync(path.join(chipdbPath, name)),
    `Native and WASI chipdb data differs: ${name}`,
  );
}
console.log(
  `nextpnr WASM: ${statSync(nextpnrWasmPath).size} bytes; ` +
    `chipdb: ${chipdbNames.map((name) => `${name}=${statSync(path.join(chipdbPath, name)).size}`).join(", ")}`,
);

for (const boardId of boardIds) {
  test(`nextpnr WASI and native match for ${boardId}`, () => {
    const board = boardsById.get(boardId);
    assert.ok(board, `Board definition is missing: ${boardId}`);
    const workdir = createWorkdir();
    const nativeWorkdir = createWorkdir();
    const wasiWorkdir = createWorkdir();
    try {
      const { files } = createBlinkTemplate(boardId, "verilog");
      const source = files.get("src/top.v");
      assert.equal(typeof source, "string", `${boardId} Verilog template is missing`);
      runYosysWasi(workdir, source);
      const jsonPath = path.join(workdir, "top.json");
      const cst = generateCst(boardId);
      for (const target of [nativeWorkdir, wasiWorkdir]) {
        writeFileSync(path.join(target, "top.json"), readFileSync(jsonPath));
        writeFileSync(path.join(target, "constraints/board.cst"), cst);
      }
      const args = pnrArgs(board);
      const native = runNative(nativeWorkdir, args);
      const wasi = runWasi(wasiWorkdir, args);
      assertSuccessful(native, "native", boardId);
      assertSuccessful(wasi, "WASI", boardId);
      const nativeDocument = JSON.parse(readFileSync(path.join(nativeWorkdir, "pnr.json"), "utf8"));
      const wasiDocument = JSON.parse(readFileSync(path.join(wasiWorkdir, "pnr.json"), "utf8"));
      comparePnrDocuments(nativeDocument, wasiDocument);
      if (boardId === boardIds[0]) {
        const mutated = structuredClone(wasiDocument);
        assert.ok(mutateCellType(mutated), "No P&R cell was available for negative control");
        assert.throws(
          () => comparePnrDocuments(nativeDocument, mutated),
          assert.AssertionError,
          "P&R comparison accepted a changed cell type",
        );
      }
      console.log(
        `${boardId}: native ${native.elapsed.toFixed(1)} ms; ` +
          `WASI ${wasi.elapsed.toFixed(1)} ms; ` +
          `process peak RSS ${process.resourceUsage().maxRSS} KiB`,
      );
    } finally {
      rmSync(workdir, { recursive: true, force: true });
      rmSync(nativeWorkdir, { recursive: true, force: true });
      rmSync(wasiWorkdir, { recursive: true, force: true });
    }
  });
}

test("invalid pin and missing chipdb fail closed", () => {
  const board = boardsById.get(boardIds[0]);
  const workdir = createWorkdir();
  const emptyChipdb = mkdtempSync(path.join(os.tmpdir(), "nextpnr-empty-chipdb-"));
  try {
    const { files } = createBlinkTemplate(board.id, "verilog");
    runYosysWasi(workdir, files.get("src/top.v"));
    writeFileSync(path.join(workdir, "constraints/board.cst"), generateCst(board.id));
    const invalidCst = "IO_LOC \"led\" INVALID_PIN_NAME;\n";
    writeFileSync(path.join(workdir, "constraints/invalid.cst"), invalidCst);
    const invalidArgs = pnrArgs(board, "constraints/invalid.cst");
    for (const [runtime, result] of [
      ["native", runNative(workdir, invalidArgs)],
      ["WASI", runWasi(workdir, invalidArgs)],
    ]) {
      assert.notEqual(result.status, 0, `${runtime} accepted a nonexistent pin`);
      assert.match(
        `${result.stderr}\n${result.stdout}`,
        /pin|CST|constraint/i,
        `${runtime} omitted a useful pin error:\n${result.stderr}\n${result.stdout}`,
      );
    }
    const missing = runWasi(workdir, pnrArgs(board), emptyChipdb);
    assert.notEqual(missing.status, 0, "WASI nextpnr accepted a missing chipdb");
    console.log(
      `WASI module size ${statSync(nextpnrWasmPath).size} bytes; ` +
        `chipdb files ${readdirSync(path.join(wasiSharePath, "himbaechel/gowin")).length}; ` +
        `sum ${readdirSync(path.join(wasiSharePath, "himbaechel/gowin")).reduce((sum, file) => sum + statSync(path.join(wasiSharePath, "himbaechel/gowin", file)).size, 0)} bytes`,
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
    rmSync(emptyChipdb, { recursive: true, force: true });
  }
});
