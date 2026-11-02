import { parentPort } from "node:worker_threads";
import { loadPyodide } from "pyodide";
import { runFormalPythonJob } from "../../web/lib/formal-python-job.mjs";

globalThis.crossOriginIsolated = true;
parentPort.once("message", async data => {
  const post = message => parentPort.postMessage(message);
  post(await runFormalPythonJob(data, loadPyodide, post));
});
