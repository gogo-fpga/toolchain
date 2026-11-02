import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

export function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

export function nodeSolverWorker(mode = "normal") {
  const worker = new Worker(new URL("./solver-node-worker.mjs", import.meta.url), { workerData: { mode }, execArgv: [] });
  const listeners = new Map();
  worker.on("error", () => {});
  return {
    postMessage: (...args) => worker.postMessage(...args),
    terminate: () => worker.terminate(),
    addEventListener(name, listener) {
      const wrapper = name === "message" ? data => listener({ data }) : error => listener({ message: error.message });
      listeners.set(listener, wrapper);
      worker.on(name, wrapper);
    },
    removeEventListener(name, listener) {
      const wrapper = listeners.get(listener);
      if (wrapper) worker.off(name, wrapper);
      listeners.delete(listener);
    },
  };
}

export function commandWasm(instructions = []) {
  const encodeName = name => [name.length, ...new TextEncoder().encode(name)];
  const section = (id, bytes) => [id, bytes.length, ...bytes];
  const body = [0, ...instructions, 11];
  return new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 96, 0, 0]),
    ...section(3, [1, 0]),
    ...section(5, [1, 1, 1, 1]),
    ...section(7, [2, ...encodeName("memory"), 2, 0, ...encodeName("_start"), 0, 0]),
    ...section(10, [1, body.length, ...body]),
  ]);
}
