import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { loadPyodide } from "pyodide";
import { BOARDS } from "../../web/lib/boards.mjs";
import { createBlinkTemplate, generateCst } from "../../web/lib/templates.mjs";
import { prepareLibrarySelection, verilogReadCommand } from "../../web/lib/libraries.mjs";
import { changeProjectLibraries, prepareProjectInputs } from "../../web/lib/project.mjs";
import { exportProjectZip, importProjectZip } from "../../web/lib/project-zip.mjs";
import { fsIdcode, fsIdcodeMatchesBoard } from "../../web/lib/fs-idcode.mjs";
import {
  prepareGowinPackRuntime,
  runGowinPack,
} from "../../web/lib/gowin-pack.mjs";
import {
  createWorkdir,
  nextpnrWasmPath,
  pnrArgs,
  runWasi,
  runYosysWasi,
} from "./nextpnr-helpers.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const packRoot = path.join(root, "build/pack");
const indexURL = pathToFileURL(`${packRoot}/pyodide/`).href;
const apyculaWheel = readdirSync(path.join(packRoot, "wheels")).find((file) =>
  file.startsWith("apycula-"),
);
assert.ok(apyculaWheel, "Pinned Apicula wheel is missing from build/pack/wheels");
const apyculaWheelURL = pathToFileURL(path.join(packRoot, "wheels", apyculaWheel)).href;
const nativePackPath = path.join(root, "build/deps/apycula-venv/bin/gowin_pack");
const nativePythonPath = path.join(root, "build/deps/apycula-venv/bin/python");
const pyodideLoader = (options) => loadPyodide(options);
const routedByBoard = new Map();
let pyodideSetupMs = 0;

assert.ok(existsSync(nextpnrWasmPath), `WASI nextpnr is missing: ${nextpnrWasmPath}`);
assert.ok(existsSync(nativePackPath), `Native gowin_pack is missing: ${nativePackPath}`);
assert.ok(existsSync(path.join(packRoot, "wheels", apyculaWheel)));

before(async () => {
  const started = performance.now();
  await prepareGowinPackRuntime({
    loadPyodide: pyodideLoader,
    indexURL,
    apyculaWheelURL,
  });
  pyodideSetupMs = performance.now() - started;
  const versions = spawnSync(
    nativePythonPath,
    ["-c", "import msgspec, numpy; print(f'numpy={numpy.__version__} msgspec={msgspec.__version__}')"],
    { encoding: "utf8" },
  );
  assert.equal(versions.status, 0, `Could not read native dependency versions:\n${versions.stderr}`);
  console.log(
    `Pyodide 314.0.7/Python 3.14.2 setup ${pyodideSetupMs.toFixed(1)} ms; ` +
      `native ${versions.stdout.trim()}; nextpnr WASM ${statSync(nextpnrWasmPath).size} bytes`,
  );
});

function createDiffSummary(expected, actual) {
  const nativeText = new TextDecoder().decode(expected);
  const pyodideText = new TextDecoder().decode(actual);
  let offset = 0;
  while (
    offset < expected.length &&
    offset < actual.length &&
    expected[offset] === actual[offset]
  ) {
    offset += 1;
  }
  const nativeLine = nativeText.slice(0, offset).split("\n").length;
  const snippet = (text) => JSON.stringify(text.slice(Math.max(0, offset - 24), offset + 48));
  return (
    `first byte difference at offset ${offset}, line ${nativeLine}; ` +
    `native=${snippet(nativeText)}; Pyodide=${snippet(pyodideText)}; ` +
    `sizes native=${expected.length}, Pyodide=${actual.length}`
  );
}

function runNativePack(board, routedJson, workdir) {
  writeFileSync(path.join(workdir, "top.json"), routedJson);
  const started = performance.now();
  const result = spawnSync(
    nativePackPath,
    ["-d", board.packDevice, "-o", "top.fs", "top.json"],
    { cwd: workdir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(
    result.status,
    0,
    `Native gowin_pack failed for ${board.id}:\n${result.stderr ?? ""}\n${result.error ?? ""}`,
  );
  const output = readFileSync(path.join(workdir, "top.fs"));
  assert.ok(output.length > 0, `Native gowin_pack produced an empty .fs for ${board.id}`);
  return { output, stderr: result.stderr ?? "", elapsed: performance.now() - started };
}

function assertBoardIdcode(bytes, board) {
  const idcode = fsIdcode(new TextDecoder().decode(bytes));
  assert.notEqual(idcode, null, `Could not read IDCODE for ${board.id}`);
  assert.ok(
    fsIdcodeMatchesBoard(idcode, board),
    `IDCODE 0x${idcode.toString(16)} does not match ${board.id}`,
  );
}

function assertTimescalePreservesBitstream(board, source, expectedFs) {
  const directive = "`timescale 1ns/1ps\n";
  assert.ok(source.startsWith(directive), "The simulation template must specify its timescale");
  const workdir = createWorkdir("gowin-pack-before-timescale-");
  try {
    runYosysWasi(workdir, source.slice(directive.length));
    writeFileSync(path.join(workdir, "constraints/board.cst"), generateCst(board.id));
    const pnr = runWasi(workdir, pnrArgs(board));
    assert.equal(pnr.status, 0, `Baseline nextpnr failed for ${board.id}:\n${pnr.stderr}`);
    const routedJson = readFileSync(path.join(workdir, "pnr.json"));
    const { output } = runNativePack(board, routedJson, workdir);
    assert.deepStrictEqual(output, expectedFs, `The timescale changed the .fs for ${board.id}`);
    console.log(`${board.id}: before/after timescale .fs SHA-256 ${createHash("sha256").update(output).digest("hex")}`);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

for (const board of BOARDS) {
  test(`Pyodide gowin_pack matches native for ${board.id}`, async () => {
    const workdir = createWorkdir("gowin-pack-test-");
    try {
      const { files } = createBlinkTemplate(board.id, "verilog");
      const source = files.get("src/top.v");
      assert.equal(typeof source, "string", `Verilog template is missing for ${board.id}`);
      runYosysWasi(workdir, source);
      writeFileSync(path.join(workdir, "constraints/board.cst"), generateCst(board.id));
      const pnr = runWasi(workdir, pnrArgs(board));
      assert.equal(pnr.status, 0, `WASI nextpnr failed for ${board.id}:\n${pnr.stderr}`);
      const routedJson = readFileSync(path.join(workdir, "pnr.json"));
      routedByBoard.set(board.id, routedJson);

      const nativeWorkdir = createWorkdir("gowin-pack-native-");
      try {
        const { output: nativeFs, elapsed: nativeElapsed } = runNativePack(board, routedJson, nativeWorkdir);
        assertBoardIdcode(nativeFs, board);
        assertTimescalePreservesBitstream(board, source, nativeFs);
        const packTimes = [];
        let fallbackWarning = "";
        for (let repeat = 0; repeat < 5; repeat += 1) {
          const started = performance.now();
          const packed = await runGowinPack({
            loadPyodide: pyodideLoader,
            indexURL,
            apyculaWheelURL,
            netlistJson: routedJson,
            device: board.packDevice,
          });
          packTimes.push(performance.now() - started);
          fallbackWarning += packed.stderr;
          assert.deepStrictEqual(
            Buffer.from(packed.fs),
            nativeFs,
            `Native/Pyodide .fs differ for ${board.id}: ${createDiffSummary(nativeFs, packed.fs)}`,
          );
          assertBoardIdcode(packed.fs, board);
        }
        const sorted = [...packTimes].sort((left, right) => left - right);
        console.log(
          `${board.id}: Pyodide gowin_pack median ${sorted[2].toFixed(1)} ms ` +
            `(min ${sorted[0].toFixed(1)}, max ${sorted[4].toFixed(1)}); ` +
            `samples [${packTimes.map((elapsed) => elapsed.toFixed(1)).join(", ")}]; ` +
            `native ${nativeElapsed.toFixed(1)} ms; .fs ${nativeFs.length} bytes`,
        );
        if (board === BOARDS[0]) {
          assert.match(fallbackWarning, /fastcrc/i, "fastcrc fallback warning was not preserved");
        }
      } finally {
        rmSync(nativeWorkdir, { recursive: true, force: true });
      }
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
}

test("pinned libfpga builds from portable ZIP into all four board bitstreams", async (t) => {
  const directory = mkdtempSync(path.join(root, "build/t5-gray-flow-"));
  const assets = path.join(directory, "assets");
  let passedBoards = 0;
  try {
    const built = spawnSync("python3", ["scripts/build-library-assets.py", "--output", assets], {
      cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(built.status, 0, `${built.stderr}\n${built.error ?? ""}`);
    const catalog = JSON.parse(readFileSync(path.join(assets, "catalog.json"), "utf8"));
    const added = await prepareLibrarySelection(
      catalog, { id: "libfpga", component: "gray" },
      (asset) => readFileSync(path.join(assets, asset.asset)), { requireConfirmed: false },
    );
    for (const board of BOARDS) {
      await t.test(board.id, async () => {
        const workdir = path.join(directory, board.id);
        for (const part of ["src", "constraints", "tmp"]) mkdirSync(path.join(workdir, part), { recursive: true });
        const template = createBlinkTemplate(board.id, "verilog");
        template.files.set("src/top.v", `// SPDX-License-Identifier: BSD-3-Clause
module top(input wire clk, output wire led);
  reg [3:0] value = 0;
  reg [3:0] delayed = 0;
  wire [3:0] gray, decoded;
  lfpga_bin2gray #(.WIDTH(4)) encoder (.bin(value), .gray(gray));
  lfpga_gray2bin #(.WIDTH(4)) decoder (.gray(delayed), .bin(decoded));
  always @(posedge clk) begin
    value <= value + 1;
    delayed <= gray;
  end
  assign led = gray[0] ^ decoded[1];
endmodule
`);
        const installed = await changeProjectLibraries(template.project, template.files, { add: added });
        const zip = await exportProjectZip(installed.project, installed.files);
        writeFileSync(path.join(workdir, "project.zip"), zip);
        const restored = await importProjectZip(zip);
        const input = await prepareProjectInputs(restored.project, restored.files);
        assert.ok(input.files.some((file) => file.path === "libraries/libfpga/sources/rtl/math/lfpga_gray.v"));
        for (const file of input.files) {
          const target = path.join(workdir, file.path);
          mkdirSync(path.dirname(target), { recursive: true });
          writeFileSync(target, file.content);
        }
        const source = input.files.find((file) => file.path === "src/top.v");
        const command = verilogReadCommand(input.files.filter((file) => file.role !== "data" && /\.vh?$/i.test(file.path)).map((file) => file.path), input);
        runYosysWasi(workdir, source.content, `${command}; synth_gowin -top top -json top.json`);
        const netlist = JSON.parse(readFileSync(path.join(workdir, "top.json"), "utf8"));
        assert.ok(Object.keys(netlist.modules.top.cells).length > 0, "The library design was optimized away");
        writeFileSync(path.join(workdir, "constraints/board.cst"), generateCst(board.id));
        const pnr = runWasi(workdir, pnrArgs(board));
        assert.equal(pnr.status, 0, `${pnr.stderr}\n${pnr.error ?? ""}`);
        const routedJson = readFileSync(path.join(workdir, "pnr.json"));
        const nativeWorkdir = path.join(workdir, "native");
        mkdirSync(nativeWorkdir);
        const native = runNativePack(board, routedJson, nativeWorkdir);
        const packed = await runGowinPack({
          loadPyodide: pyodideLoader, indexURL, apyculaWheelURL,
          netlistJson: routedJson, device: board.packDevice,
        });
        assertBoardIdcode(native.output, board);
        assertBoardIdcode(packed.fs, board);
        assert.deepEqual(Buffer.from(packed.fs), native.output, createDiffSummary(native.output, packed.fs));
        passedBoards += 1;
      });
    }
  } finally {
    if (passedBoards === BOARDS.length) rmSync(directory, { recursive: true, force: true });
    else console.error(`Retained failing library-flow evidence: ${directory}`);
  }
});

test("invalid routed JSON and a missing Apicula wheel fail closed", async () => {
  await assert.rejects(
    runGowinPack({
      loadPyodide: pyodideLoader,
      indexURL,
      apyculaWheelURL,
      netlistJson: '{"broken":',
      device: BOARDS[0].packDevice,
    }),
    /gowin_pack exited|failed/i,
  );
  await assert.rejects(
    runGowinPack({
      loadPyodide: pyodideLoader,
      indexURL,
      apyculaWheelURL: pathToFileURL(path.join(root, "build/pack/missing-apycula.whl")).href,
      netlistJson: "{}",
      device: BOARDS[0].packDevice,
    }),
    /ENOENT|no such file/i,
  );
});

test("a wrong pack device is rejected or produces a different IDCODE", async () => {
  const routedJson = routedByBoard.get(BOARDS[0].id);
  assert.ok(routedJson, "Tang Nano 1K routed JSON was not produced");
  try {
    const packed = await runGowinPack({
      loadPyodide: pyodideLoader,
      indexURL,
      apyculaWheelURL,
      netlistJson: routedJson,
      device: BOARDS[3].packDevice,
    });
    const idcode = fsIdcode(new TextDecoder().decode(packed.fs));
    assert.ok(
      idcode === null || !fsIdcodeMatchesBoard(idcode, BOARDS[0]),
      "Wrong pack device produced a bitstream with the 1K IDCODE",
    );
  } catch (error) {
    assert.match(`${error.message}\n${error.stderr ?? ""}`, /device|family|chip|pack/i);
  }
});

test("a corrupted cached Apicula wheel hash makes the asset build fail", () => {
  const negativeRoot = mkdtempSync(path.join(root, "build/pack-negative-"));
  const negativeCache = path.join(negativeRoot, "cache");
  const negativeOutput = path.join(negativeRoot, "output");
  const cacheSource = path.join(root, "build/cache/pack");
  try {
    const wheels = readdirSync(cacheSource).filter((file) => file.endsWith(".whl"));
    assert.ok(wheels.some((file) => file.startsWith("apycula-")), "Apycula wheel cache is missing");
    mkdirSync(negativeCache, { recursive: true });
    for (const wheel of wheels) {
      copyFileSync(path.join(cacheSource, wheel), path.join(negativeCache, wheel));
    }
    const apyculaWheelName = wheels.find((file) => file.startsWith("apycula-"));
    const corrupted = readFileSync(path.join(negativeCache, apyculaWheelName));
    corrupted[0] ^= 0xff;
    writeFileSync(path.join(negativeCache, apyculaWheelName), corrupted);
    const result = spawnSync(path.join(root, "scripts/build-pack-assets.sh"), [], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PACK_ASSET_CACHE_DIR: negativeCache,
        PACK_ASSET_DIR: negativeOutput,
      },
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.notEqual(result.status, 0, "Asset build accepted a corrupted Apicula wheel");
    assert.match(`${result.stdout}\n${result.stderr}`, /Apycula wheel cache failed hash verification/);
  } finally {
    rmSync(negativeRoot, { recursive: true, force: true });
  }
});

function totalAssetSize(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = path.join(directory, entry.name);
    return total + (entry.isDirectory() ? totalAssetSize(entryPath) : statSync(entryPath).size);
  }, 0);
}

after(() => {
  console.log(
    `Pyodide gowin_pack setup ${pyodideSetupMs.toFixed(1)} ms; ` +
      `asset total ${totalAssetSize(packRoot)} bytes`,
  );
});
