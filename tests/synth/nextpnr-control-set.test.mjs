import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const upstream = path.join(root, "vendor/nextpnr/common/place/placer_heap.cc");
const patchFile = path.join(root, "patches/nextpnr/0002-stabilize-equal-coordinate-cuts.patch");
const sha256 = (content) => createHash("sha256").update(content).digest("hex");

test("the nextpnr source preparer preserves upstream, is idempotent, and rejects bad patches and metadata", () => {
  const directory = mkdtempSync(path.join(root, "build/t5-pnr-prepare-check-"));
  let passed = false;
  try {
    const original = readFileSync(upstream);
    const source = path.join(directory, "original.cc");
    const output = path.join(directory, "patched/placer_heap.cc");
    const metadataPath = path.join(directory, "patched/placer_heap.json");
    writeFileSync(source, original);
    const prepare = (patch, destination = output, origin = source) => spawnSync("python3", [
      path.join(root, "scripts/prepare-pnr-source.py"), "--source", origin, "--patch", patch, "--output", destination,
    ], { encoding: "utf8" });
    const prepared = prepare(patchFile);
    assert.equal(prepared.status, 0, prepared.stderr);
    const patched = readFileSync(output);
    assert.equal(patched.toString(), original.toString().replace(
      "std::sort(cut_cells.begin(), cut_cells.end()", "std::stable_sort(cut_cells.begin(), cut_cells.end()",
    ));
    assert.deepEqual(readFileSync(upstream), original);
    assert.deepEqual(readFileSync(source), original);
    const metadata = JSON.parse(readFileSync(metadataPath));
    assert.deepEqual(metadata, {
      source_sha256: sha256(original), patch: path.basename(patchFile),
      patch_sha256: sha256(readFileSync(patchFile)), patched_source_sha256: sha256(patched),
    });
    for (const file of [output, metadataPath]) utimesSync(file, 1000, 1000);
    assert.equal(prepare(patchFile).status, 0);
    for (const file of [output, metadataPath]) assert.equal(statSync(file).mtimeMs, 1000000);
    assert.equal(prepare(patchFile, source).status, 1);
    assert.deepEqual(readFileSync(source), original);
    assert.equal(prepare(patchFile, path.join(directory, "collision.json")).status, 1);
    const alias = path.join(directory, "alias.json");
    writeFileSync(alias, original);
    assert.equal(prepare(patchFile, path.join(directory, "alias.cc"), alias).status, 1);
    assert.deepEqual(readFileSync(alias), original);
    const patchCopy = path.join(directory, "valid.patch");
    writeFileSync(patchCopy, readFileSync(patchFile));
    assert.equal(prepare(patchCopy, patchCopy).status, 1);
    assert.deepEqual(readFileSync(patchCopy), readFileSync(patchFile));
    const invalidPatch = path.join(directory, "invalid.patch");
    writeFileSync(invalidPatch, readFileSync(patchFile, "utf8").replace("-            std::sort", "-            std::absent_sort"));
    assert.equal(prepare(invalidPatch).status, 1);
    assert.deepEqual(readFileSync(output), patched);
    const verify = () => spawnSync("python3", ["-c", `
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location("pnr_info", ${JSON.stringify(path.join(root, "scripts/build-pnr-info.py"))})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.patch_metadata(Path(${JSON.stringify(directory)}))
`], { encoding: "utf8" });
    assert.equal(verify().status, 0);
    const rejected = (pattern) => {
      const result = verify();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, pattern);
    };
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, source_sha256: "0".repeat(64) }));
    rejected(/patch metadata does not match/);
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, patch: "../outside.patch" }));
    rejected(/Invalid nextpnr patch path/);
    writeFileSync(metadataPath, JSON.stringify(metadata));
    writeFileSync(output, Buffer.concat([patched, Buffer.from("// corruption\n")]));
    rejected(/patch metadata does not match/);
    passed = true;
  } finally {
    if (passed) rmSync(directory, { recursive: true, force: true });
    else console.error(`Source preparation evidence retained: ${directory}`);
  }
});

function checker(source) {
  const bodies = [...source.matchAll(/std::stable_sort\(result.begin\(\), result.end\(\), \[&\]\(Loc a, Loc b\) \{([\s\S]*?)\n        \}\);/g)];
  assert.equal(bodies.length, 1, "Expected one control-set candidate comparator");
  return `#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <vector>
struct Loc { int x, y, z; };
int main() {
  for (int cx = -2; cx <= 2; ++cx) for (int cy = -2; cy <= 2; ++cy) {
    auto compare = [&](Loc a, Loc b) {${bodies[0][1]}
    };
    std::vector<Loc> original;
    for (int x = -2; x <= 2; ++x) for (int y = -2; y <= 2; ++y)
      original.push_back({x, y, int(original.size())});
    for (auto a : original) {
      if (compare(a, a)) { std::fprintf(stderr, "CONTROL_SET_NOT_IRREFLEXIVE\\n"); return 1; }
      for (auto b : original) {
        if (compare(a, b) && compare(b, a)) { std::fprintf(stderr, "CONTROL_SET_NOT_ASYMMETRIC\\n"); return 1; }
        for (auto c : original) {
          if (compare(a, b) && compare(b, c) && !compare(a, c)) {
            std::fprintf(stderr, "CONTROL_SET_NOT_TRANSITIVE\\n"); return 1;
          }
        }
      }
    }
    std::vector<Loc> expected;
    for (int distance = 0; distance <= 8; ++distance) for (auto a : original) {
      int dx = a.x < cx ? cx - a.x : a.x - cx;
      int dy = a.y < cy ? cy - a.y : a.y - cy;
      if (dx + dy == distance) expected.push_back(a);
    }
    auto actual = original;
    std::stable_sort(actual.begin(), actual.end(), compare);
    if (actual.size() != expected.size()) return 2;
    for (unsigned i = 0; i < actual.size(); ++i) {
      if (actual[i].z != expected[i].z) { std::fprintf(stderr, "CONTROL_SET_WRONG_ORDER\\n"); return 1; }
    }
  }
  std::puts("CONTROL_SET_ORDER_OK centers=25 locations=25 triples=390625");
}
`;
}

function assertPatchedOrdering(patchName, makeChecker, failure, success) {
  const directory = mkdtempSync(path.join(root, "build/t5-control-set-check-"));
  let passed = false;
  try {
    mkdirSync(path.join(directory, "common/place"), { recursive: true });
    const original = readFileSync(upstream, "utf8");
    writeFileSync(path.join(directory, "common/place/placer_heap.cc"), original);
    const patch = path.join(root, "patches/nextpnr", patchName);
    const applied = spawnSync("patch", ["--batch", "--fuzz=0", "-p1", "-i", patch], {
      cwd: directory, encoding: "utf8",
    });
    assert.equal(applied.status, 0, `${applied.stderr}\n${applied.stdout}\n${applied.error ?? ""}`);
    const patched = readFileSync(path.join(directory, "common/place/placer_heap.cc"), "utf8");
    for (const [variant, source] of [["original", original], ["patched", patched]]) {
      const input = path.join(directory, `${variant}.cc`);
      const executable = path.join(directory, variant);
      writeFileSync(input, source.slice(0, source.indexOf("#include")) + makeChecker(source));
      const compiled = spawnSync(process.env.CXX ?? "c++", ["-std=c++17", "-O2", "-Wall", "-Wextra", "-Werror", input, "-o", executable], {
        encoding: "utf8",
      });
      assert.equal(compiled.status, 0, `${compiled.stderr}\n${compiled.error ?? ""}`);
      const result = spawnSync(executable, [], { encoding: "utf8" });
      assert.equal(result.error, undefined);
      assert.equal(result.status, variant === "original" ? 1 : 0, result.stderr);
      if (variant === "original") assert.match(result.stderr, failure);
      else assert.equal(result.stdout, success);
    }
    passed = true;
  } finally {
    if (passed) rmSync(directory, { recursive: true, force: true });
    else console.error(`Control-set evidence retained: ${directory}`);
  }
}

test("the nextpnr control-set patch restores strict weak ordering and stable Manhattan order", () => {
  assertPatchedOrdering("0001-fix-control-set-distance-comparison.patch", checker,
    /CONTROL_SET_NOT_IRREFLEXIVE/, "CONTROL_SET_ORDER_OK centers=25 locations=25 triples=390625\n");
});

function cutChecker(source) {
  const calls = [...source.matchAll(/std::(?:stable_)?sort\(cut_cells.begin\(\), cut_cells.end\(\), \[&\]\(const CellInfo \*a, const CellInfo \*b\) \{[\s\S]*?\n            \}\);/g)];
  assert.equal(calls.length, 1, "Expected one cut-region coordinate sort");
  return `#include <algorithm>
#include <cstdio>
#include <vector>
struct CellInfo { int name; };
struct Position { double rawx, rawy; };
struct Placer { std::vector<Position> cell_locs; };
int main() {
  Placer placer;
  auto p = &placer;
  std::vector<CellInfo> cells(33);
  for (int axis = 0; axis < 2; ++axis) for (int mixed = 0; mixed < 2; ++mixed) {
    bool dir = axis != 0;
    std::vector<CellInfo *> cut_cells;
    p->cell_locs.clear();
    for (int i = 0; i < 33; ++i) {
      cells[i].name = i;
      cut_cells.push_back(&cells[i]);
      p->cell_locs.push_back({double(mixed ? (i * 17) % 5 : 0), double(mixed ? (i * 13) % 7 : 0)});
    }
    std::vector<int> expected;
    for (int key = 0; key < 7; ++key) for (int i = 0; i < 33; ++i) {
      auto loc = p->cell_locs.at(i);
      if ((dir ? loc.rawy : loc.rawx) == key) expected.push_back(i);
    }
    ${calls[0][0]}
    if (expected.size() != cut_cells.size()) return 2;
    for (unsigned i = 0; i < expected.size(); ++i) {
      if (cut_cells[i]->name != expected[i]) { std::fprintf(stderr, "CUT_TIE_ORDER_CHANGED\\n"); return 1; }
    }
  }
  std::puts("CUT_TIE_ORDER_OK axes=2 patterns=2 cells=33");
}
`;
}

test("the nextpnr cut patch preserves equal-coordinate input order on both axes", () => {
  assertPatchedOrdering("0002-stabilize-equal-coordinate-cuts.patch", cutChecker,
    /CUT_TIE_ORDER_CHANGED/, "CUT_TIE_ORDER_OK axes=2 patterns=2 cells=33\n");
});
