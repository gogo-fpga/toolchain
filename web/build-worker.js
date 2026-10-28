import { getBoard } from "./lib/boards.mjs";
import { releaseDecoders } from "./lib/decompress.mjs";
import { createVerifiedAssetLoader, safePath } from "./lib/verified-assets.mjs";
import { createMemoryTree, runWasiP1 } from "./lib/wasi-p1.mjs";
import { readUstar } from "./lib/ustar.mjs";

const synthURL = new URL("./synth/", import.meta.url);
const synthCacheName = "gogo-fpga-synth-v1";
const synthAssets = createVerifiedAssetLoader({
  baseURL: synthURL,
  cacheName: synthCacheName,
  label: "Synthesis asset",
});
const requiredAssetPaths = [
  "yosys.wasm",
  "nextpnr-himbaechel-gowin.wasm",
  "yosys-share.tar",
];

function insertFile(tree, path, content) {
  if (!safePath(path)) throw new Error(`Invalid project file path: ${path}`);
  const parts = path.split("/");
  let directory = tree;
  for (const part of parts.slice(0, -1)) {
    const current = directory[part];
    if (current === undefined) directory[part] = {};
    else if (
      current === null ||
      typeof current !== "object" ||
      current instanceof Uint8Array
    ) {
      throw new Error(`Conflicting project file path: ${path}`);
    }
    directory = directory[part];
  }
  const name = parts.at(-1);
  if (directory[name] !== undefined) throw new Error(`Duplicate project file path: ${path}`);
  if (typeof content === "string") directory[name] = content;
  else if (content instanceof Uint8Array) directory[name] = new Uint8Array(content);
  else if (content instanceof ArrayBuffer) directory[name] = new Uint8Array(content);
  else throw new Error(`Invalid content for project file: ${path}`);
}

function readMemoryFile(directory, path) {
  let current = directory;
  const parts = path.split("/");
  for (const part of parts.slice(0, -1)) {
    const entry = current.entries.get(part);
    if (entry?.type !== "directory") return null;
    current = entry;
  }
  const file = current.entries.get(parts.at(-1));
  return file?.type === "file" ? new Uint8Array(file.data) : null;
}

function makeLogger(tool, stream) {
  const textDecoder = new TextDecoder();
  let captured = "";
  return {
    write(bytes) {
      const text = textDecoder.decode(bytes, { stream: true });
      if (text) {
        captured += text;
        self.postMessage({ type: "log", tool, stream, text });
      }
    },
    flush() {
      const text = textDecoder.decode();
      if (text) {
        captured += text;
        self.postMessage({ type: "log", tool, stream, text });
      }
    },
    get text() {
      return captured;
    },
  };
}

function checkedFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("The project has no Verilog source files");
  }
  const tree = { build: {}, tmp: {} };
  const sourcePaths = [];
  let constraintPath = null;
  for (const file of files) {
    if (!file || typeof file.path !== "string") {
      throw new Error("A project file has an invalid path");
    }
    insertFile(tree, file.path, file.content);
    if (/\.(?:v|sv)$/i.test(file.path)) sourcePaths.push(file.path);
    if (/\.cst$/i.test(file.path)) {
      if (constraintPath) throw new Error("The project has multiple constraint files");
      constraintPath = file.path;
    }
  }
  if (sourcePaths.length === 0) {
    throw new Error("The project has no Verilog source files");
  }
  if (!constraintPath) throw new Error("The project has no generated constraint file");
  return { tree, sourcePaths, constraintPath };
}

function toolResult(module, args, workdir, share, tool) {
  const stdout = makeLogger(tool, "stdout");
  const stderr = makeLogger(tool, "stderr");
  let result;
  try {
    result = runWasiP1(module, {
      args,
      env: { TMPDIR: "/tmp" },
      preopens: {
        "/": workdir,
        "/share": share,
        "/tmp": workdir.entries.get("tmp"),
      },
      stdout: (bytes) => stdout.write(bytes),
      stderr: (bytes) => stderr.write(bytes),
    });
  } finally {
    stdout.flush();
    stderr.flush();
  }
  return { ...result, stdout: stdout.text, stderr: stderr.text };
}

let building = false;
self.addEventListener("message", async ({ data }) => {
  if (data?.type !== "build") {
    self.postMessage({
      type: "error",
      stage: "synth",
      message: "Unsupported build worker message",
    });
    return;
  }
  if (building) {
    self.postMessage({
      type: "error",
      stage: "synth",
      message: "A build is already running",
    });
    return;
  }

  building = true;
  let stage = "synth";
  try {
    const board = getBoard(data.board);
    if (!board) throw new Error(`Unknown board: ${data.board}`);
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(data.top ?? "")) {
      throw new Error("The top module name is invalid");
    }
    const { tree, sourcePaths, constraintPath } = checkedFiles(data.files);
    self.postMessage({ type: "stage", stage });
    const assets = await synthAssets.loadManifest();
    const chipdbPath = `chipdb/chipdb-${board.nextpnrFamily}.bin`;
    for (const path of [...requiredAssetPaths, chipdbPath]) {
      if (!assets.has(path)) {
        throw new Error(`Synthesis asset is missing from manifest: ${path}`);
      }
    }
    const cache = await synthAssets.openCache();
    let loadedAssets;
    try {
      loadedAssets = await Promise.all([
        synthAssets.fetchVerifiedAsset(assets, "yosys.wasm", cache),
        synthAssets.fetchVerifiedAsset(assets, "nextpnr-himbaechel-gowin.wasm", cache),
        synthAssets.fetchVerifiedAsset(assets, "yosys-share.tar", cache),
        synthAssets.fetchVerifiedAsset(assets, chipdbPath, cache),
      ]);
    } finally {
      releaseDecoders();
    }
    await synthAssets.pruneCache(cache, assets);
    const [yosysBytes, nextpnrBytes, shareTar, chipdbBytes] = loadedAssets;
    const [yosysModule, nextpnrModule] = await Promise.all([
      WebAssembly.compile(yosysBytes),
      WebAssembly.compile(nextpnrBytes),
    ]);
    const yosysShareTree = readUstar(shareTar);
    const nextpnrShareTree = {};
    insertFile(
      nextpnrShareTree,
      `himbaechel/gowin/chipdb-${board.nextpnrFamily}.bin`,
      chipdbBytes,
    );
    const workdir = createMemoryTree(tree);
    const yosysShare = createMemoryTree(yosysShareTree);
    const nextpnrShare = createMemoryTree(nextpnrShareTree);

    const yosysCommand =
      `read_verilog ${sourcePaths.map((path) => JSON.stringify(path)).join(" ")}; ` +
      `synth_gowin -top ${data.top} -json build/top.json`;
    const synthStarted = performance.now();
    const yosysResult = toolResult(
      yosysModule,
      ["yosys", "-q", "-p", yosysCommand],
      workdir,
      yosysShare,
      "yosys",
    );
    if (yosysResult.exitCode !== 0) {
      throw new Error(
        `Yosys exited with status ${yosysResult.exitCode}\n${yosysResult.stderr}${yosysResult.stdout}`,
      );
    }
    const topJson = readMemoryFile(workdir, "build/top.json");
    if (!topJson?.byteLength) throw new Error("Yosys did not create build/top.json");
    const synthTime = performance.now() - synthStarted;

    stage = "pnr";
    self.postMessage({ type: "stage", stage });
    const pnrArgs = [
      "--seed",
      "73421",
      "--device",
      board.nextpnrDevice,
      "--vopt",
      `family=${board.nextpnrFamily}`,
      "--vopt",
      `cst=${constraintPath}`,
      "--json",
      "build/top.json",
      "--write",
      "build/top_pnr.json",
    ];
    const pnrStarted = performance.now();
    const nextpnrResult = toolResult(
      nextpnrModule,
      ["nextpnr-himbaechel-gowin", ...pnrArgs],
      workdir,
      nextpnrShare,
      "nextpnr",
    );
    if (nextpnrResult.exitCode !== 0) {
      throw new Error(
        `nextpnr exited with status ${nextpnrResult.exitCode}\n${nextpnrResult.stderr}${nextpnrResult.stdout}`,
      );
    }
    const routedJson = readMemoryFile(workdir, "build/top_pnr.json");
    if (!routedJson?.byteLength) {
      throw new Error("nextpnr did not create build/top_pnr.json");
    }
    const pnrTime = performance.now() - pnrStarted;

    const files = [
      { path: "build/top.json", bytes: topJson },
      { path: "build/top_pnr.json", bytes: routedJson },
    ];
    self.postMessage(
      {
        type: "done",
        files,
        timings: { synth: synthTime, pnr: pnrTime },
        memoryBytes: {
          yosys: yosysResult.memoryBytes,
          nextpnr: nextpnrResult.memoryBytes,
        },
      },
      files.map(({ bytes }) => bytes.buffer),
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      stage,
      message: String(error?.message ?? error),
    });
  } finally {
    building = false;
  }
});
