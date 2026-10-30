// Adapted from synth-explorer/tools/ghdl-wasm/ghdl_synth_test.mjs.
// Copyright 2025 synth-explorer contributors.
// Licensed under the Apache License, Version 2.0.
// https://www.apache.org/licenses/LICENSE-2.0
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { WASI } from "node:wasi";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const buildRoot = path.resolve(root, process.env.GHDL_WASM_BUILD_ROOT ?? "build");
const fixtureRoot = path.join(root, "tests/fixtures/vhdl");
const wasmPath = path.join(buildRoot, "ghdl-wasm/ghdl-synth.wasm");
const libDir = path.join(buildRoot, "ghdl-native/lib/ghdl");
const nativePath = path.join(buildRoot, "ghdl-native/bin/ghdl");
const wasmModule = new WebAssembly.Module(readFileSync(wasmPath));
const vhdlRoot = "/ghdl/lib/ghdl";
const decoder = new TextDecoder("latin1");
const wasmSandboxes = new Set();

process.on("exit", () => {
  for (const sandbox of wasmSandboxes) {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

assert.ok(statSync(libDir).isDirectory(), `GHDL libraries are missing: ${libDir}`);
assert.ok(statSync(nativePath).isFile(), `Native GHDL is missing: ${nativePath}`);

function normalizePath(value) {
  const absolute = value.startsWith("/");
  const parts = value.split("/");
  const normalized = [];
  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      if (normalized.length > 0) {
        normalized.pop();
      }
      continue;
    }
    normalized.push(part);
  }
  return `${absolute ? "/" : ""}${normalized.join("/")}`;
}

class VirtualFileSystem {
  constructor() {
    this.files = new Map();
    this.descriptors = new Map();
    this.nextDescriptor = 100;
  }

  add(pathname, contents) {
    this.files.set(
      normalizePath(pathname),
      Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8"),
    );
  }

  addReal(pathname, realPath) {
    this.add(pathname, readFileSync(realPath));
  }

  has(pathname) {
    return this.files.has(normalizePath(pathname));
  }

  open(pathname) {
    const normalized = normalizePath(pathname);
    const contents = this.files.get(normalized);
    if (!contents) {
      return -1;
    }
    const descriptor = this.nextDescriptor;
    this.nextDescriptor += 1;
    this.descriptors.set(descriptor, { pathname: normalized, position: 0, contents });
    return descriptor;
  }

  close(descriptor) {
    this.descriptors.delete(descriptor);
  }

  get(descriptor) {
    return this.descriptors.get(descriptor);
  }

  length(descriptor) {
    return this.get(descriptor)?.contents.length ?? -1;
  }

  eof(descriptor) {
    const file = this.get(descriptor);
    return !file || file.position >= file.contents.length;
  }

  read(descriptor, destination, length) {
    const file = this.get(descriptor);
    if (!file) {
      return -1;
    }
    const count = Math.min(length, file.contents.length - file.position);
    if (count <= 0) {
      return 0;
    }
    destination.set(file.contents.subarray(file.position, file.position + count));
    file.position += count;
    return count;
  }
}

function loadLibraryTree(vfs, realDir, virtualDir) {
  for (const entry of readdirSync(realDir)) {
    const realPath = path.join(realDir, entry);
    const virtualPath = `${virtualDir}/${entry}`;
    if (statSync(realPath).isDirectory()) {
      loadLibraryTree(vfs, realPath, virtualPath);
    } else {
      vfs.addReal(virtualPath, realPath);
    }
  }
}

function runWasm(top, files) {
  const vfs = new VirtualFileSystem();
  loadLibraryTree(vfs, libDir, vhdlRoot);
  const sandboxRoot = mkdtempSync(path.join(tmpdir(), "ghdl-wasm-"));
  const wasiWorkDir = sandboxRoot;
  const wasiGhdlDir = path.join(sandboxRoot, "ghdl");
  wasmSandboxes.add(sandboxRoot);
  const wasiLibraryDir = path.join(wasiGhdlDir, "lib/ghdl");
  mkdirSync(wasiWorkDir, { recursive: true });
  mkdirSync(wasiLibraryDir, { recursive: true });
  cpSync(libDir, wasiLibraryDir, { recursive: true });
  const stdoutPath = path.join(sandboxRoot, "stdout");
  const stderrPath = path.join(sandboxRoot, "stderr");
  writeFileSync(stdoutPath, "");
  writeFileSync(stderrPath, "");
  const stdoutFd = openSync(stdoutPath, "w+");
  const stderrFd = openSync(stderrPath, "w+");
  const wasi = new WASI({
    version: "preview1",
    args: [],
    env: {},
    preopens: { "/": sandboxRoot },
    stdout: stdoutFd,
    stderr: stderrFd,
  });
  const chunks = [];
  let instance;
  let memory;
  const bytes = () => new Uint8Array(memory.buffer);
  const view = () => new DataView(memory.buffer);
  const wasiImports = wasi.getImportObject();
  const emit = (value) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value, "latin1"));
  const cString = (pointer) => {
    if (!pointer) {
      return "";
    }
    const content = bytes();
    let end = pointer;
    while (content[end] !== 0) {
      end += 1;
    }
    return decoder.decode(content.subarray(pointer, end));
  };
  const fatString = (pointer, boundsPointer) => {
    const first = view().getInt32(boundsPointer, true);
    const last = view().getInt32(boundsPointer + 4, true);
    return last < first
      ? ""
      : decoder.decode(bytes().subarray(pointer, pointer + last - first + 1));
  };
  const writeFatString = (dataPointer, boundsPointer, value) => {
    const content = bytes();
    const bounds = view();
    for (let index = 0; index < value.length; index += 1) {
      content[dataPointer + index] = value.charCodeAt(index);
    }
    bounds.setInt32(boundsPointer, 1, true);
    bounds.setInt32(boundsPointer + 4, value.length, true);
  };
  const allocationSize = (pointer) => {
    if (!pointer) {
      return 0;
    }
    const base = pointer - 16;
    const blockSize = view().getUint32(base + 4, true);
    return (blockSize & ~1) - base - 16;
  };
  const env = {
    gnat__directory_operations__get_current_dir: (data, bounds) =>
      writeFatString(data, bounds, "/work"),
    ada__command_line__command_name: (data, bounds) => writeFatString(data, bounds, "ghdl"),
    ada__command_line__argument_count: () => 0,
    ada__command_line__argument: (data, bounds) => writeFatString(data, bounds, ""),
    ada__exceptions__exception_identity: () => 0,
    ada__exceptions__exception_name: () => {},
    ada__exceptions__exception_information: () => {},
    strlen: (pointer) => {
      const content = bytes();
      let length = 0;
      while (content[pointer + length] !== 0) {
        length += 1;
      }
      return length;
    },
    strcmp: (left, right) => {
      const content = bytes();
      for (let index = 0; ; index += 1) {
        const difference = content[left + index] - content[right + index];
        if (difference !== 0) {
          return difference;
        }
        if (content[left + index] === 0) {
          return 0;
        }
      }
    },
    realloc: (pointer, size) => {
      if (!pointer) {
        return instance.exports.malloc(size);
      }
      if (!size) {
        instance.exports.free(pointer);
        return 0;
      }
      const oldSize = allocationSize(pointer);
      const replacement = instance.exports.malloc(size);
      if (!replacement) {
        return 0;
      }
      bytes().copyWithin(replacement, pointer, pointer + Math.min(oldSize, size));
      instance.exports.free(pointer);
      return replacement;
    },
    fopen: (pointer) => {
      const descriptor = vfs.open(cString(pointer));
      return descriptor <= 0 ? 0 : descriptor;
    },
    fclose: (descriptor) => {
      vfs.close(descriptor);
      return 0;
    },
    fread: (pointer, size, count, descriptor) => {
      const read = vfs.read(descriptor, bytes().subarray(pointer, pointer + size * count), size * count);
      return read < 0 ? 0 : Math.floor(read / size);
    },
    fwrite: (pointer, size, count) => {
      emit(Buffer.from(bytes().subarray(pointer, pointer + size * count)));
      return count;
    },
    fputs: (pointer) => {
      const value = cString(pointer);
      emit(value);
      return value.length;
    },
    fgets: (pointer, size, descriptor) => {
      const content = bytes();
      let count = 0;
      while (count < size - 1) {
        const value = new Uint8Array(1);
        if (vfs.read(descriptor, value, 1) <= 0) {
          break;
        }
        content[pointer + count] = value[0];
        count += 1;
        if (value[0] === 0x0a) {
          break;
        }
      }
      if (!count) {
        return 0;
      }
      content[pointer + count] = 0;
      return pointer;
    },
    fflush: () => 0,
    feof: (descriptor) => (vfs.eof(descriptor) ? 1 : 0),
    ftell: (descriptor) => vfs.get(descriptor)?.position ?? -1,
    getc: (descriptor) => {
      const value = new Uint8Array(1);
      return vfs.read(descriptor, value, 1) <= 0 ? -1 : value[0];
    },
    putc: (value) => {
      emit(Buffer.from([value & 0xff]));
      return value;
    },
    ungetc: (value, descriptor) => {
      const file = vfs.get(descriptor);
      if (file && file.position > 0) {
        file.position -= 1;
      }
      return value;
    },
    setbuf: () => {},
    isatty: () => 0,
    fprintf: () => 0,
    snprintf: () => 0,
    __ghdl_get_stdout: () => 1,
    __ghdl_get_stderr: () => 2,
    __ghdl_get_stdin: () => 0,
    putc_unlocked: (value) => {
      emit(Buffer.from([value & 0xff]));
      return value;
    },
    getc_unlocked: (descriptor) => {
      const value = new Uint8Array(1);
      return vfs.read(descriptor, value, 1) <= 0 ? -1 : value[0];
    },
    feof_unlocked: (descriptor) => (vfs.eof(descriptor) ? 1 : 0),
    __ghdl_fprintf_g: (_descriptor, value) => emit(String(value)),
    __ghdl_snprintf_fmtf: (pointer, length, _format, value) => {
      const text = String(value).slice(0, length - 1);
      for (let index = 0; index < text.length; index += 1) {
        bytes()[pointer + index] = text.charCodeAt(index);
      }
      bytes()[pointer + text.length] = 0;
    },
    gnat__os_lib__is_regular_file: (pointer, bounds) => (vfs.has(fatString(pointer, bounds)) ? 1 : 0),
    gnat__os_lib__is_absolute_path: (pointer, bounds) =>
      (fatString(pointer, bounds).startsWith("/") ? 1 : 0),
    gnat__os_lib__is_directory: () => 0,
    gnat__os_lib__is_executable_file: () => 0,
    gnat__os_lib__delete_file: (_a, _b, _c, ok) => {
      if (ok) {
        view().setInt32(ok, 0, true);
      }
    },
    gnat__os_lib__rename_file: (...args) => {
      const ok = args.at(-1);
      if (ok) {
        view().setInt32(ok, 0, true);
      }
    },
    gnat__os_lib__file_time_stamp: () => 0n,
    gnat__os_lib__open_read__2: (pointer) => vfs.open(cString(pointer)),
    gnat__os_lib__close: (descriptor) => vfs.close(descriptor),
    gnat__os_lib__create_file__2: () => -1,
    gnat__os_lib__file_length: (descriptor) => vfs.length(descriptor),
    gnat__os_lib__read: (descriptor, pointer, length) => {
      const read = vfs.read(descriptor, bytes().subarray(pointer, pointer + length), length);
      return read < 0 ? 0 : read;
    },
    gnat__os_lib__write: (_descriptor, pointer, length) => {
      emit(Buffer.from(bytes().subarray(pointer, pointer + length)));
      return length;
    },
    gnat__os_lib__spawn: () => -1,
    gnat__os_lib__locate_exec_on_path: (data, bounds) => writeFatString(data, bounds, ""),
    ada__calendar__clock: () => 0,
    ada__calendar__time_zones__utc_time_offset: () => 0,
    ada__calendar__Osubtract: () => 0,
    ada__calendar__split: () => {},
    ada__characters__handling__to_lower: (value) => value,
    gnat__sha1__update: () => {},
    gnat__sha1__digest__4: () => {},
    gnat__sha1__digest__5: () => {},
    gnat__heap_sort_a__sort: () => {},
    system__img_lli__impl__image_integer: () => 0,
    system__val_lli__impl__value_integer: () => 0n,
    __gnat_put_exception: (pointer, length, line) => {
      const message = Buffer.from(bytes().subarray(pointer, pointer + length)).toString();
      emit(line ? `Predefined exception raised at ${message}:${line}\n` : `User exception: ${message}\n`);
    },
    __gnat_put_int: (value) => emit(`${value}`),
    __gnat_put_char: (value) => emit(Buffer.from([value & 0xff])),
    __gnat_put_string: (pointer, length) => emit(Buffer.from(bytes().subarray(pointer, pointer + length))),
    __gnat_grow: (value) => value,
    ceil: Math.ceil,
    floor: Math.floor,
    round: Math.round,
    trunc: Math.trunc,
    fmod: (left, right) => left % right,
    fmin: Math.min,
    fmax: Math.max,
    log10: Math.log10,
    cbrt: Math.cbrt,
    getenv: () => 0,
    exit: (code) => {
      throw Object.assign(new Error(`exit(${code})`), { exitCode: code, isExit: true });
    },
    time: (pointer) => {
      const value = 0n;
      if (pointer) {
        view().setBigInt64(pointer, value, true);
      }
      return value;
    },
    ctime: () => 0,
    __ghdl_maybe_return_via_longjump: () => {},
    __ghdl_run_through_longjump: (functionPointer, argument) => {
      if (functionPointer) {
        try {
          instance.exports.__indirect_function_table.get(functionPointer)(argument);
        } catch {}
      }
      return 0;
    },
    __ghdl_ELABORATE: () => {},
    grt_dynload_open: () => 0,
    grt_dynload_symbol: () => 0,
    grt_save_backtrace: () => {},
    grt_get_clk_tck: () => 100,
    grt_get_times: () => {},
    backtrace_create_state: () => 0,
    backtrace_pcinfo: () => 0,
    loadVhpiModule: () => 0,
    loadVpiModule: () => 0,
    Increment_p_vpi_vecval: () => {},
    vpi_get_value_vec_helper: () => {},
    fstWriterCreate: () => 0,
    fstWriterClose: () => {},
    fstWriterSetFileType: () => {},
    fstWriterSetPackType: () => {},
    fstWriterSetTimescale: () => {},
    fstWriterSetVersion: () => {},
    fstWriterSetRepackOnClose: () => {},
    fstWriterSetParallelMode: () => {},
    fstWriterCreateVar2: () => 0,
    fstWriterSetSourceStem: () => {},
    fstWriterSetSourceInstantiationStem: () => {},
    fstWriterSetScope: () => {},
    fstWriterSetUpscope: () => {},
    fstWriterEmitValueChange: () => {},
    fstWriterEmitVariableLengthValueChange: () => {},
    fstWriterEmitTimeChange: () => {},
    gzopen: () => 0,
    gzwrite: () => 0,
    gzputc: () => 0,
    gzclose: () => {},
    __multi3: (resultPointer, aLow, aHigh, bLow, bHigh) => {
      const a = (BigInt.asUintN(64, aHigh) << 64n) | BigInt.asUintN(64, aLow);
      const b = (BigInt.asUintN(64, bHigh) << 64n) | BigInt.asUintN(64, bLow);
      const result = BigInt.asUintN(128, a * b);
      view().setBigUint64(resultPointer, result & ((1n << 64n) - 1n), true);
      view().setBigUint64(resultPointer + 8, result >> 64n, true);
    },
  };
  instance = new WebAssembly.Instance(wasmModule, { env, ...wasiImports });
  wasi.initialize(instance);
  memory = instance.exports.memory;
  const pagesNeeded = 1024 - Math.ceil(memory.buffer.byteLength / 65536);
  if (pagesNeeded > 0) {
    memory.grow(pagesNeeded);
  }
  if (typeof instance.exports._initialize !== "function") {
    instance.exports.__wasm_call_ctors();
  }
  const exports = instance.exports;
  const pushString = (value) => {
    const content = Buffer.from(value, "latin1");
    const pointer = exports.malloc(content.length + 1);
    bytes().set(content, pointer);
    bytes()[pointer + content.length] = 0;
    return [pointer, content.length];
  };
  const diagnostics = () =>
    Buffer.concat([
      readFileSync(stdoutPath),
      readFileSync(stderrPath),
      Buffer.concat(chunks),
    ]).toString("latin1");

  if (exports.ghdlwasm_init) {
    exports.ghdlwasm_init();
  }
  const initResult = exports.synth_api__synth_init();
  if (initResult !== 0) {
    return { status: initResult, output: diagnostics(), stage: "initialize" };
  }

  for (const file of files) {
    const contents = readFileSync(path.join(fixtureRoot, file.name));
    vfs.add(file.name, contents);
    writeFileSync(path.join(wasiWorkDir, file.name), contents);
    const [pointer, length] = pushString(file.name);
    let result = 0;
    let error;
    try {
      result = exports.synth_api__analyze_file(pointer, length);
    } catch (caught) {
      error = caught.isExit ? `EXIT(${caught.exitCode})` : caught.message;
    }
    exports.free(pointer);
    if (error || result !== 0) {
      return {
        status: result || 1,
        output: diagnostics(),
        error,
        stage: `analyze ${file.name}`,
      };
    }
  }

  chunks.length = 0;
  const [topPointer, topLength] = pushString(top.toLowerCase());
  let result = 0;
  let error;
  const synthStartedAt = performance.now();
  try {
    result = exports.synth_api__synth_top(topPointer, topLength);
  } catch (caught) {
    error = caught.isExit ? `EXIT(${caught.exitCode})` : caught.message;
  }
  const synthDurationMs = performance.now() - synthStartedAt;
  exports.free(topPointer);
  return {
    status: error || result !== 0 ? result || 1 : 0,
    output: diagnostics(),
    error,
    stage: "synthesize",
    synthDurationMs,
  };
}

function runNative(top, files) {
  const workDir = mkdtempSync(path.join(tmpdir(), "ghdl-native-"));
  try {
    for (const file of files) {
      writeFileSync(
        path.join(workDir, file.name),
        readFileSync(path.join(fixtureRoot, file.name)),
      );
    }
    const analyze = spawnSync(nativePath, ["-a", "--std=08", ...files.map((file) => file.name)], {
      cwd: workDir,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (analyze.status !== 0) {
      return {
        status: analyze.status ?? 1,
        output: `${analyze.stdout ?? ""}${analyze.stderr ?? ""}`,
        error: analyze.error,
      };
    }
    const synthesis = spawnSync(
      nativePath,
      ["--synth", "--std=08", "--out=verilog", top],
      {
        cwd: workDir,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
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
];

for (const fixture of positiveFixtures) {
  test(`GHDL WASM synthesizes ${fixture.label}`, () => {
    const files = fixture.files.map((name) => ({ name }));
    const wasm = runWasm(fixture.top, files);
    if (process.env.GHDL_WASM_TIMING_RUN) {
      console.log(
        `S9B_TIMING ${JSON.stringify({
          run: process.env.GHDL_WASM_TIMING_RUN,
          fixture: fixture.label,
          duration_ms: wasm.synthDurationMs,
        })}`,
      );
    }
    assert.equal(
      wasm.status,
      0,
      `WASM synthesis failed at ${wasm.stage}:\n${wasm.output}\n${wasm.error ?? ""}`,
    );
    assert.match(wasm.output, new RegExp(`module\\s+${fixture.top}\\b`));

    const native = runNative(fixture.top, files);
    assert.equal(native.status, 0, `Native synthesis failed:\n${native.output}\n${native.error ?? ""}`);
    const equal = wasm.output === native.output;
    assert.equal(
      wasm.output,
      native.output,
      `${fixture.label}: ${differenceSummary(native.output, wasm.output)}`,
    );
    if (process.env.GHDL_WASM_EXPORT_DIR) {
      mkdirSync(process.env.GHDL_WASM_EXPORT_DIR, { recursive: true });
      writeFileSync(
        path.join(process.env.GHDL_WASM_EXPORT_DIR, `${fixture.top}.v`),
        wasm.output,
        "latin1",
      );
    }
    console.log(
      `${fixture.label}: ${equal ? "byte-identical" : differenceSummary(native.output, wasm.output)}`,
    );
  });
}

for (const fixture of [
  { name: "syntax_error.vhd", top: "syntax_error" },
  { name: "semantic_error.vhd", top: "semantic_error" },
]) {
  test(`GHDL WASM reports file and line for ${fixture.name}`, () => {
    const result = runWasm(fixture.top, [{ name: fixture.name }]);
    assert.notEqual(result.status, 0, "Invalid VHDL unexpectedly synthesized");
    assert.match(
      result.output,
      new RegExp(`${fixture.name.replaceAll(".", "\\.")}:\\d+(?::\\d+)?`),
      `No file:line diagnostic at ${result.stage}: ${result.error ?? ""}`,
    );
  });
}
