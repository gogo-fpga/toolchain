import { parentPort } from "node:worker_threads";
import { runSolverJob } from "../../web/lib/solver-job.mjs";

globalThis.crossOriginIsolated = true;
parentPort.once("message", async data => {
  const wait = Atomics.wait.bind(Atomics);
  let observed = false;
  Atomics.wait = (...args) => {
    if (!observed && args[0]?.buffer === data.channels.stdin.buffer && args[1] === 3) {
      observed = true;
      parentPort.postMessage({ type: "test-observation", jobId: data.jobId, event: "solver-stdin-wait", channel: "stdin", index: args[1], sha256: data.sha256 });
      if (data.testControl.mode === "timeout") wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
    return wait(...args);
  };
  parentPort.postMessage(await runSolverJob(data));
});
