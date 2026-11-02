import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { attachBytePipe } from "../../web/lib/byte-pipe.mjs";
import { createFormalProcessClient } from "../../web/lib/formal-process-client.mjs";
import { startFormalPython } from "../../web/lib/formal-python-process.mjs";
import { runFormalPythonJob } from "../../web/lib/formal-python-job.mjs";
import { nodeFormalWorker } from "../synth/formal-python-helpers.mjs";
import { commandWasm, nodeSolverWorker, sha256 } from "./solver-process-helpers.mjs";

globalThis.crossOriginIsolated = true;
const bytes = text => new TextEncoder().encode(text);
const pythonAdapter = new Uint8Array(readFileSync(new URL("../../web/formal_process.py", import.meta.url)));

function sources(text) {
  const assets = [{ path: "smtbmc.py", bytes: bytes(text) }, { path: "formal_process.py", bytes: pythonAdapter }];
  return { sources: assets, manifest: { format_version: 1,
    assets: assets.map(file => ({ path: file.path, size: file.bytes.length, sha256: sha256(file.bytes) })) } };
}

function fakeWorker(send) {
  const listeners = new Map();
  return {
    terminated: 0,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    terminate() { this.terminated++; },
    postMessage(data) { queueMicrotask(() => send(data, (message, type = "message") => listeners.get(type)?.(type === "message" ? { data: message } : message))); },
  };
}

function fakeRun(send, options = {}) {
  const worker = fakeWorker(send);
  const job = startFormalPython({ workerFactory: () => worker, timeoutMs: 50, ...options });
  return { worker, job };
}

test("formal worker accepts a bounded verified exit, ignores old IDs and detaches after completion", async () => {
  const { worker, job } = fakeRun((data, send) => {
    send({ type: "exit", jobId: "old", exitCode: 0 });
    send({ type: "exit", jobId: data.jobId, exitCode: 4, integrityVerified: true, files: [] });
    send({ type: "failure", jobId: data.jobId, status: "runtime-error", error: "late" });
  });
  const result = await job.completion;
  assert.equal(result.status, "exited"); assert.equal(result.exitCode, 4);
  assert.equal(result.jobId, job.jobId); assert.equal(worker.terminated, 1);
  job.cancel(); assert.equal((await job.completion).status, "exited");
});

test("formal worker rejects forged success, unverified exits, malformed files and invented failures", async () => {
  const exit = { type: "exit", exitCode: 0, integrityVerified: true, files: [] };
  for (const message of [
    { ...exit, integrityVerified: false }, { ...exit, exitCode: -1 }, { ...exit, exitCode: 256 },
    { ...exit, files: null }, { ...exit, files: [{ path: "../bad", bytes: bytes("x") }] },
    { ...exit, files: [{ path: "trace", bytes: "x" }] },
    { ...exit, files: [{ path: "a", bytes: bytes("1") }, { path: "a", bytes: bytes("2") }] },
    { type: "failure", status: "exited", error: "forged" }, { type: "failure", status: "PASS", error: "forged" },
    { type: "stdout", text: 7 }, { type: "unknown" },
  ]) {
    const { worker, job } = fakeRun((data, send) => send({ ...message, jobId: data.jobId }));
    assert.equal((await job.completion).status, "protocol-error", JSON.stringify(message));
    assert.equal(worker.terminated, 1);
  }
});

test("formal worker enforces deadlines, cancellation, crash, decoding, output and callback limits", async () => {
  const silent = fakeRun(() => {});
  assert.equal((await silent.job.completion).status, "timeout");
  const cancelled = fakeRun(() => {}); cancelled.job.cancel();
  assert.equal((await cancelled.job.completion).status, "cancelled");
  const crashed = fakeRun((data, send) => send({ message: "crash" }, "error"));
  assert.equal((await crashed.job.completion).status, "crashed");
  const corrupt = fakeRun((data, send) => send({}, "messageerror"));
  assert.equal((await corrupt.job.completion).status, "protocol-error");
  const limit = fakeRun((data, send) => send({ type: "stdout", jobId: data.jobId, text: "x".repeat(8 * 1024 * 1024 + 1) }));
  assert.equal((await limit.job.completion).status, "output-limit");
  const callback = fakeRun((data, send) => send({ type: "stdout", jobId: data.jobId, text: "x" }), {
    onStdout() { throw new Error("callback"); },
  });
  assert.equal((await callback.job.completion).status, "protocol-error");
  for (const timeoutMs of [0, -1, NaN, Infinity, 300001, 1.5]) assert.throws(() => fakeRun(() => {}, { timeoutMs }), RangeError);
  assert.throws(() => fakeRun(() => {}, { onStdout: null }), TypeError);
  assert.throws(() => startFormalPython({ workerFactory: () => ({ terminate() {} }) }), TypeError);
});

test("formal Python verifies asset identity, count, paths and bytes before loading its runtime", async () => {
  let loads = 0;
  const base = { ...sources("pass\n"), jobId: "asset-test", entrypoint: "smtbmc", args: [], files: [] };
  const run = data => runFormalPythonJob(data, () => { loads++; throw new Error("Unexpected load"); }, () => {});
  for (const data of [
    { ...base, entrypoint: "../smtbmc" }, { ...base, args: ["a\0b"] },
    { ...base, sources: [] }, { ...base, sources: [base.sources[0], base.sources[0]] },
    { ...base, sources: [{ ...base.sources[0], bytes: bytes("evil\n") }, base.sources[1]] },
    { ...base, files: [{ path: "../trace", bytes: bytes("x") }] },
    { ...base, files: [{ path: "a", bytes: bytes("x") }, { path: "a", bytes: bytes("x") }] },
    { ...base, files: [{ path: "a", bytes: "bad" }] },
    { ...base, files: [{ path: "a\0b", bytes: bytes("x") }] },
  ]) {
    const result = await run(data);
    assert.equal(result.type, "failure"); assert.notEqual(result.status, "exited");
  }
  assert.equal(loads, 0);
});

function channelClient() {
  let endpoints;
  const client = createFormalProcessClient(message => {
    if (message.type !== "spawn-solver") return;
    endpoints = { input: attachBytePipe(message.channels.stdin, "reader"),
      output: attachBytePipe(message.channels.stdout, "writer"),
      stderr: attachBytePipe(message.channels.stderr, "writer"), control: new Int32Array(message.control) };
  }, "unit");
  const handle = client.spawn_solver({ toJs: () => ["unit"] });
  return { handle, ...endpoints, client };
}

test("virtual process preserves split UTF-8 lines, pending timeouts, EOF and stdin", () => {
  const { handle, input, output, stderr, control } = channelClient();
  assert.equal(handle.poll(), null); assert.equal(handle.readline(0), null);
  const line = bytes("日本語\nlast");
  output.writeSync(line.slice(0, 2)); assert.equal(handle.readline(0), null);
  output.writeSync(line.slice(2));
  assert.equal(new TextDecoder().decode(handle.readline(0)), "日本語\n");
  assert.equal(handle.readline(0), null);
  assert.equal(handle.stdin_write({ toJs: () => bytes("input") }), 5);
  assert.equal(new TextDecoder().decode(input.readAvailable(5)), "input");
  handle.stdin_close(); assert.equal(input.readAvailable(1).length, 0);
  output.end(); stderr.end(); Atomics.store(control, 0, 1);
  assert.equal(new TextDecoder().decode(handle.readline(0)), "last");
  assert.equal(handle.readline(0).length, 0); assert.equal(handle.poll(), 0); assert.equal(handle.finish(), 0);
});

test("virtual process rejects corrupt controls, nonzero completion, separate stderr and malformed commands", () => {
  for (const [state, code, pattern] of [[2, 0, /failed/], [7, 0, /state/], [1, -1, /code/]]) {
    const { handle, control } = channelClient(); Atomics.store(control, 0, state); Atomics.store(control, 1, code);
    assert.throws(() => handle.poll(), pattern);
  }
  const failed = channelClient(); failed.output.end(); failed.stderr.end();
  Atomics.store(failed.control, 1, 9); Atomics.store(failed.control, 0, 1);
  assert.equal(failed.handle.poll(), 9); assert.throws(() => failed.handle.finish(), /code 9/);
  const separate = channelClient(); separate.stderr.writeSync(bytes("error"));
  assert.throws(() => separate.handle.readline(0), /separate/);
  const { handle, client } = channelClient();
  for (const value of [-2, NaN, Infinity, 301, "0"]) assert.throws(() => handle.readline(value), RangeError);
  for (const args of [[], ["a\0b"], ["x".repeat(257)], [7], null]) {
    assert.throws(() => client.spawn_solver({ toJs: () => args }), TypeError);
  }
  handle.terminate(); assert.throws(() => handle.readline(0), /cancelled/);
});

test("the real Pyodide adapter distinguishes SystemExit, runtime errors and verified solver completion", { timeout: 20000 }, async () => {
  const run = (text, solvers = {}) => startFormalPython({ ...sources(text), entrypoint: "smtbmc", args: [], files: [], solvers,
    workerFactory: nodeFormalWorker, solverWorkerFactory: () => nodeSolverWorker(), timeoutMs: 10000 }).completion;
  const exited = await run("raise SystemExit(4)\n");
  assert.equal(exited.status, "exited"); assert.equal(exited.exitCode, 4);
  const exception = await run("raise RuntimeError('unit failure')\n");
  assert.equal(exception.status, "runtime-error");
  const wasm = commandWasm();
  const text = "from formal_process import Popen\nfrom subprocess import PIPE, STDOUT\np = Popen(['unit'], stdin=PIPE, stdout=PIPE, stderr=STDOUT)\np.stdin.close()\np.wait()\n";
  const completed = await run(text, { unit: { wasm, sha256: sha256(wasm) } });
  assert.equal(completed.status, "exited", completed.error);
  assert.equal(completed.exitCode, 0); assert.equal(completed.children.length, 1);
  assert.equal(completed.children[0].integrityVerified, true);
  const mismatch = await run(text, { unit: { wasm, sha256: "0".repeat(64) } });
  assert.notEqual(mismatch.status, "exited"); assert.equal(mismatch.children[0].status, "integrity-error");
});

test("cancellation stops an active solver and waits for its terminal evidence", { timeout: 10000 }, async () => {
  const wasm = commandWasm([3, 64, 12, 0, 11]);
  const text = "from formal_process import Popen\nfrom subprocess import PIPE, STDOUT\np = Popen(['unit'], stdin=PIPE, stdout=PIPE, stderr=STDOUT)\nprint('solver-started', flush=True)\np.wait()\n";
  let started = false;
  const job = startFormalPython({ ...sources(text), entrypoint: "smtbmc", args: [], files: [],
    solvers: { unit: { wasm, sha256: sha256(wasm) } }, workerFactory: nodeFormalWorker,
    solverWorkerFactory: () => nodeSolverWorker(), timeoutMs: 8000,
    onStdout(line) { if (line.includes("solver-started")) { started = true; job.cancel(); } },
  });
  const result = await job.completion;
  assert.equal(started, true); assert.equal(result.status, "cancelled");
  assert.equal(result.children.length, 1); assert.equal(result.children[0].status, "cancelled");
  assert.notEqual(result.children[0].exitCode, 0);
});
