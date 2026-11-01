import assert from "node:assert/strict";
import test from "node:test";
import { assertYosysParity, creatorPrefix, nativeYosysSharePath } from "./yosys-parity.mjs";

function documents() {
  const native = {
    creator: `${creatorPrefix}, native compiler)`,
    modules: { top: { cells: { gate: {
      type: "LUT4", parameters: { INIT: "0110" },
      attributes: { src: `${nativeYosysSharePath}/gowin/cells_sim.v:1` },
    } } } },
  };
  const wasi = structuredClone(native);
  wasi.creator = `${creatorPrefix}, WASI compiler)`;
  wasi.modules.top.cells.gate.attributes.src = "/share/gowin/cells_sim.v:1";
  return { native, wasi };
}

test("Yosys parity only normalizes compiler identity and share source attributes", () => {
  const { native, wasi } = documents();
  const before = structuredClone({ native, wasi });
  assertYosysParity(native, wasi);
  assert.deepEqual({ native, wasi }, before);
});

test("Yosys parity rejects changed circuit, key order, version, and unrelated paths", () => {
  const mutations = [
    (value) => { value.modules.top.cells.gate.parameters.INIT = "1111"; },
    (value) => { value.modules.top.cells.gate.type = "LUT3"; },
    (value) => { value.modules.top.cells.gate = Object.fromEntries(Object.entries(value.modules.top.cells.gate).reverse()); },
    (value) => { value.creator = "unverified Yosys"; },
    (value) => { value.modules.top.cells.gate.parameters.INIT = nativeYosysSharePath; },
  ];
  for (const mutate of mutations) {
    const { native, wasi } = documents();
    mutate(wasi);
    assert.throws(() => assertYosysParity(native, wasi), assert.AssertionError);
  }
});
