import { validateFormalProperties } from "./formal-properties.mjs";

const identifier = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function decodeSignal(signal, width, samples) {
  if (!signal || typeof signal.wave !== "string" || signal.wave.length !== samples) {
    throw new Error("Missing or inconsistent replay signal length");
  }
  const data = signal.data ?? [];
  if (!Array.isArray(data) || width === 1 && data.length) throw new Error("Invalid replay signal data");
  const values = [];
  let previous;
  let offset = 0;
  for (const symbol of signal.wave) {
    let value;
    if (symbol === ".") {
      if (previous === undefined) throw new Error("Replay signal starts with a repetition");
      value = previous;
    } else if (symbol === "4") {
      if (width > 1 && data[offset++] !== "") throw new Error("Invalid missing replay sample");
      value = null;
    } else if (width === 1 && /^[01]$/.test(symbol)) {
      value = symbol;
    } else if (width > 1 && symbol === "=") {
      value = data[offset++];
      if (typeof value !== "string" || !/^[01]+$/.test(value) || value.length !== width) {
        throw new Error("Unknown or invalid replay bus value");
      }
    } else {
      throw new Error("Unsupported replay wave symbol");
    }
    values.push(value);
    previous = value;
  }
  if (offset !== data.length) throw new Error("Unused replay signal data");
  return values;
}

function requireInitializedRegisters(module) {
  const initialized = new Map();
  for (const net of Object.values(module.netnames ?? {})) {
    const value = net.attributes?.init;
    if (value === undefined) continue;
    if (typeof value !== "string" || !/^[01]+$/.test(value) || value.length !== net.bits?.length) {
      throw new Error("Replay requires concrete register initialization");
    }
    [...value].reverse().forEach((bit, index) => {
      const wire = net.bits[index];
      if (initialized.has(wire) && initialized.get(wire) !== bit) throw new Error("Conflicting replay initialization");
      initialized.set(wire, bit);
    });
  }
  for (const cell of Object.values(module.cells)) {
    if (cell.type !== "$dff") continue;
    if (!Array.isArray(cell.connections?.Q) || cell.connections.Q.some((bit) => !initialized.has(bit))) {
      throw new Error("Replay of unconstrained initial state is unsupported");
    }
  }
}

export function createSatReplay({ document, top, witness, clock = null, edge = "posedge", mode = "bmc", depth }) {
  if (!identifier.test(top) || !Number.isSafeInteger(depth) || depth < 1 || depth > 1024) {
    throw new Error("Invalid replay top or depth");
  }
  const inventory = validateFormalProperties(document, document, { top, clock, edge, mode });
  const module = document.modules[top];
  requireInitializedRegisters(module);
  const signals = new Map();
  if (!Array.isArray(witness?.signal) || witness.signal.length === 0) throw new Error("Missing replay witness");
  for (const signal of witness.signal) {
    if (!signal || typeof signal.name !== "string" || signals.has(signal.name)) throw new Error("Duplicate or invalid replay signal");
    signals.set(signal.name, signal);
  }
  const initial = inventory.registers ? 1 : 0;
  const samples = witness.signal[0].wave?.length;
  const steps = samples - initial;
  if (!Number.isSafeInteger(steps) || steps < 1 || steps > depth || mode === "bmc" && steps !== depth) {
    throw new Error("Replay depth does not match the witness");
  }
  const ports = Object.entries(module.ports).map(([name, port], index) => {
    const width = port?.bits?.length;
    if (!identifier.test(name) || !["input", "output"].includes(port?.direction) ||
        !Number.isSafeInteger(width) || width < 1 || width > 4096) throw new Error("Unsupported replay port");
    const values = decodeSignal(signals.get(name), width, samples).slice(initial);
    if (name !== clock && values.some((value) => value === null)) throw new Error("Unknown replay port value");
    return { name, direction: port.direction, width, variable: `p${index}`, values };
  });
  if (ports.length > 1024) throw new Error("Too many replay ports");
  const locations = inventory.properties.filter(({ kind }) => kind !== "cover").map((property) => {
    const match = /^([^:|\r\n]+):(\d+)\.\d+-\d+\.\d+$/.exec(property.source);
    if (!match) throw new Error("Unsupported replay property source");
    return { ...property, path: match[1], line: Number(match[2]) };
  });
  if (new Set(locations.map(({ path, line }) => `${path}:${line}`)).size !== locations.length) {
    throw new Error("Replay requires distinct property source lines");
  }
  const clockPort = ports.find(({ name }) => name === clock);
  const inactive = edge === "posedge" ? 0 : 1;
  const lines = ["`timescale 1ns/1ps", "module __formal_replay;"];
  for (const port of ports) lines.push(`  ${port.direction === "input" ? "reg" : "wire"} [${port.width - 1}:0] ${port.variable};`);
  lines.push(`  \\${top}  dut (${ports.map(({ name, variable }) => `.\\${name} (${variable})`).join(", ")});`);
  lines.push("  initial begin", '    $dumpfile("formal-replay.vcd");', "    $dumpvars(0, __formal_replay);");
  if (clockPort) lines.push(`    ${clockPort.variable} = 1'b${inactive};`);
  for (let step = 0; step < steps; step++) {
    lines.push(`    $display("FORMAL_REPLAY_DRIVE ${step + 1}");`);
    if (step && clockPort) {
      lines.push(`    #1; ${clockPort.variable} = 1'b${1 - inactive};`);
    }
    for (const port of ports.filter(({ name, direction }) => direction === "input" && name !== clock)) {
      lines.push(`    ${port.variable} ${step && clockPort ? "<=" : "="} ${port.width}'b${port.values[step]};`);
    }
    if (step && clockPort) lines.push(`    #1; ${clockPort.variable} = 1'b${inactive};`);
    lines.push("    #1;");
    for (const port of ports.filter(({ direction }) => direction === "output")) {
      lines.push(`    if (${port.variable} !== ${port.width}'b${port.values[step]}) $fatal(1, "FORMAL_REPLAY_MISMATCH ${step + 1} ${port.name}");`);
    }
    lines.push(`    $display("FORMAL_REPLAY_CHECK ${step + 1}");`);
  }
  lines.push('    $display("FORMAL_REPLAY_DONE");', "    $finish;", "  end", "endmodule", "");
  return { path: "__formal/replay.v", content: lines.join("\n"), steps, locations, endTimeNs: clockPort ? 3 * steps - 2 : steps };
}

export function verifySatReplay(replay, execution) {
  const reject = (reason) => ({ status: "rejected", reason });
  if (execution?.status !== 0 || typeof execution.stdout !== "string" || typeof execution.stderr !== "string") {
    return reject("Replay did not finish normally");
  }
  if (execution.stderr.trim()) return reject("Replay emitted diagnostics on stderr");
  let vcd;
  try {
    vcd = typeof execution.vcd === "string" ? execution.vcd :
      execution.vcd instanceof Uint8Array ? new TextDecoder("utf-8", { fatal: true }).decode(execution.vcd) : "";
  } catch {
    return reject("Replay emitted invalid VCD bytes");
  }
  if (!vcd.includes("$enddefinitions $end") || !vcd.includes("$scope module __formal_replay $end")) {
    return reject("Replay did not preserve its independent waveform");
  }
  const scale = /\$timescale\s+(1|10|100)\s*(s|ms|us|ns|ps|fs)\s+\$end/.exec(vcd);
  const exponents = { s: 0, ms: 3, us: 6, ns: 9, ps: 12, fs: 15 };
  const times = [...vcd.matchAll(/^#(\d+)\s*$/gm)].map((match) => Number(match[1]));
  if (!scale || !vcd.includes("$dumpvars") || times[0] !== 0 ||
      times.some((time, index) => !Number.isSafeInteger(time) || index && time <= times[index - 1]) ||
      times.at(-1) !== replay.endTimeNs * 10 ** (exponents[scale?.[2]] - 9) / Number(scale?.[1])) {
    return reject("Replay waveform is incomplete or has inconsistent timing");
  }
  const lines = execution.stdout.split(/\r?\n/);
  const markers = lines.filter((line) => line.startsWith("FORMAL_REPLAY_"));
  const expected = Array.from({ length: replay.steps }, (_, step) =>
    [`FORMAL_REPLAY_DRIVE ${step + 1}`, `FORMAL_REPLAY_CHECK ${step + 1}`]).flat();
  expected.push("FORMAL_REPLAY_DONE");
  if (JSON.stringify(markers) !== JSON.stringify(expected)) return reject("Replay observations are incomplete or inconsistent");
  const failures = [];
  let step = 0;
  let finished = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (line.startsWith("FORMAL_REPLAY_DRIVE ")) step = Number(line.split(" ")[1]);
    if (line === "FORMAL_REPLAY_DONE") finished = true;
    if (line.startsWith("FORMAL_REPLAY_") || line === "VCD info: dumpfile formal-replay.vcd opened for output.") continue;
    if (/^(?:work\/)?__formal\/replay\.v:\d+: \$finish called at \d+ \((?:1|10|100)(?:s|ms|us|ns|ps|fs)\)$/.test(line) && finished) continue;
    const match = /^ERROR: (?:work\/)?([^:]+):(\d+):\s*$/.exec(line);
    if (!match || !step || finished || !/^\s+Time: \d+\s+Scope: __formal_replay\.dut(?:\.[A-Za-z_][A-Za-z0-9_$]*)*\s*$/.test(lines[++index] ?? "")) {
      return reject("Unexpected replay failure or diagnostic");
    }
    const property = replay.locations.find(({ path, line: sourceLine }) => path === match[1] && sourceLine === Number(match[2]));
    if (!property || property.kind !== "assert") return reject("Replay violated an assumption or an unknown property");
    failures.push({ id: property.id, step, source: property.source });
  }
  if (!failures.length) return reject("Replay did not reproduce a property violation");
  return { status: "verified", steps: replay.steps, failures };
}
