import { getBoard } from "./lib/boards.mjs";
import {
  prepareGowinPackRuntime,
  runGowinPack,
} from "./lib/gowin-pack.mjs";

const indexURL = new URL("./pack/pyodide/", import.meta.url).href;
const apyculaWheelURL = new URL(
  "./pack/wheels/apycula-0.35-py3-none-any.whl",
  import.meta.url,
).href;
let loadPyodidePromise;

async function getLoadPyodide() {
  if (!loadPyodidePromise) {
    loadPyodidePromise = import(new URL("./pack/pyodide/pyodide.mjs", import.meta.url))
      .then((module) => module.loadPyodide);
    loadPyodidePromise.catch(() => {
      loadPyodidePromise = null;
    });
  }
  return loadPyodidePromise;
}

function sendLog(stream, text) {
  if (text) self.postMessage({ type: "log", tool: "gowin_pack", stream, text });
}

self.addEventListener("message", async ({ data }) => {
  if (data?.type !== "pack") {
    self.postMessage({
      type: "error",
      stage: "pack",
      message: "Unsupported pack worker message",
    });
    return;
  }

  self.postMessage({ type: "stage", stage: "pack" });
  try {
    const started = performance.now();
    const board = getBoard(data.board);
    if (!board) throw new Error(`Unknown board: ${data.board}`);
    const loadPyodide = await getLoadPyodide();
    await prepareGowinPackRuntime({ loadPyodide, indexURL, apyculaWheelURL });
    const result = await runGowinPack({
      loadPyodide,
      indexURL,
      apyculaWheelURL,
      netlistJson: new Uint8Array(data.netlistJson),
      device: board.packDevice,
    });
    sendLog("stdout", result.stdout);
    sendLog("stderr", result.stderr);
    const bytes = result.fs;
    self.postMessage(
      {
        type: "done",
        files: [{ path: "build/top.fs", bytes }],
        timings: { pack: performance.now() - started },
        memoryBytes: { gowin_pack: result.memoryBytes },
      },
      [bytes.buffer],
    );
  } catch (error) {
    sendLog("stdout", error?.stdout ?? "");
    sendLog("stderr", error?.stderr ?? "");
    self.postMessage({
      type: "error",
      stage: "pack",
      message: String(error?.message ?? error),
    });
  }
});
