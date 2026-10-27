import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
