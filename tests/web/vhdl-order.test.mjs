import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeVhdlDesign,
  orderVhdlFiles,
} from "../../web/lib/vhdl-order.mjs";

const file = (path, content) => ({ path, content });

test("orders package, package body, entity and architecture dependencies", () => {
  const architecture = file(
    "src/top.vhd",
    "entity top is end entity;\nuse work.cfg.all;\n" +
      "architecture rtl of top is\nbegin\n  u: entity work.child;\nend architecture;\n",
  );
  const child = file("src/child.vhd", "entity child is end entity;\n");
  const body = file(
    "src/pkg-body.vhd",
    "package body cfg is end package body;\n",
  );
  const packageUnit = file(
    "src/pkg.vhd",
    "package cfg is end package;\n",
  );
  const result = orderVhdlFiles([architecture, child, body, packageUnit]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(
    result.order.map(({ path }) => path),
    ["src/child.vhd", "src/pkg.vhd", "src/top.vhd", "src/pkg-body.vhd"],
  );
});

test("preserves input order for unrelated files and ignores non-work libraries", () => {
  const first = file("src/first.vhd", "use ieee.std_logic_1164.all;\nentity first is end;\n");
  const second = file("src/second.vhd", "library vendor; use vendor.parts.all;\nentity second is end;\n");
  const result = orderVhdlFiles([first, second]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.order, [first, second]);
});

test("ignores declarations and references inside comments and literals", () => {
  const source = file(
    "src/top.vhd",
    [
      "-- entity missing is end;",
      "/* use work.fake.all; architecture a of fake is */",
      'entity top is constant s : string := "use work.ghost.all;"; end entity;',
      "architecture rtl of top is constant c : character := 'x'; begin null; end;",
    ].join("\n"),
  );
  const result = orderVhdlFiles([source]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.order, [source]);
});

test("reports unresolved work references with the source line", () => {
  const result = orderVhdlFiles([
    file("src/top.vhd", "entity top is end;\nuse work.missing.all;\n"),
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [{
    file: "src/top.vhd",
    line: 2,
    message: 'Unresolved work reference "missing"',
  }]);
});

test("reports file dependency cycles with filenames and source lines", () => {
  const result = orderVhdlFiles([
    file("src/a.vhd", "package a is use work.b.all; end;"),
    file("src/b.vhd", "package b is use work.a.all; end;"),
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every(({ message, line }) =>
    message.includes("src/a.vhd") &&
    message.includes("src/b.vhd") &&
    Number.isInteger(line)
  ));
});

test("orders context and configuration dependencies", () => {
  const top = file("src/top.vhd", "configuration top_cfg of top is end;");
  const context = file("src/context.vhd", "context common is end context;");
  const entity = file("src/entity.vhd", "entity top is end entity;\ncontext work.common;\n");
  const result = orderVhdlFiles([top, entity, context]);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.order.map(({ path }) => path),
    ["src/context.vhd", "src/entity.vhd", "src/top.vhd"],
  );
});

test("identifies VHDL entities instantiated by other VHDL units", () => {
  const files = [
    file("src/top.vhd", "entity top is end;\narchitecture rtl of top is begin u: entity work.child; end;"),
    file("src/child.vhd", "entity child is end;"),
  ];
  const units = analyzeVhdlDesign(files);
  const instantiated = new Set(
    units.flatMap(({ references }) =>
      references
        .filter(({ usage }) => usage === "instantiation")
        .map(({ name }) => name)
    ),
  );
  assert.deepEqual(
    units.flatMap(({ declarations }) =>
      declarations
        .filter(({ kind, name }) => kind === "entity" && !instantiated.has(name))
        .map(({ name }) => name)
    ),
    ["top"],
  );
});
