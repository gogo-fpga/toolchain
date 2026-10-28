import assert from "node:assert/strict";
import test from "node:test";

import { verifyManifest } from "../../web/lib/synth-manifest.mjs";

const digest = "a".repeat(64);
const legacyAsset = {
  path: "yosys.wasm",
  size: 10,
  sha256: digest,
};

test("manifest validation accepts legacy and zstd entries", () => {
  const assets = verifyManifest({
    format_version: 1,
    assets: [
      legacyAsset,
      {
        path: "chipdb/chipdb-GW1NZ-1.bin",
        size: 20,
        sha256: digest,
        encoding: "zstd",
        compressed_size: 12,
        compressed_sha256: "b".repeat(64),
      },
    ],
  });

  assert.equal(assets.get("yosys.wasm").encoding, undefined);
  assert.equal(assets.get("chipdb/chipdb-GW1NZ-1.bin").encoding, "zstd");
});

test("manifest validation rejects unknown encodings and incomplete zstd metadata", () => {
  for (const entry of [
    { ...legacyAsset, encoding: "gzip" },
    { ...legacyAsset, encoding: "zstd", compressed_size: 12 },
    {
      ...legacyAsset,
      encoding: "zstd",
      compressed_size: 0,
      compressed_sha256: digest,
    },
    {
      ...legacyAsset,
      encoding: "zstd",
      compressed_size: 12,
      compressed_sha256: "invalid",
    },
  ]) {
    assert.throws(
      () => verifyManifest({ format_version: 1, assets: [entry] }),
      /Synthesis asset manifest contains an invalid entry/,
    );
  }
});

test("manifest validation rejects unsafe and repeated paths", () => {
  assert.throws(
    () =>
      verifyManifest({
        format_version: 1,
        assets: [{ ...legacyAsset, path: "../yosys.wasm" }],
      }),
    /Synthesis asset manifest contains an invalid entry/,
  );
  assert.throws(
    () =>
      verifyManifest({
        format_version: 1,
        assets: [legacyAsset, legacyAsset],
      }),
    /Synthesis asset manifest repeats yosys\.wasm/,
  );
});
