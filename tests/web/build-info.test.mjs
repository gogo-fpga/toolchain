import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "../..");

test("build-web rejects missing or tampered build metadata", async (t) => {
  const buildRoot = resolve(repoRoot, process.env.BUILD_ROOT ?? "build");
  const sourceArtifacts = resolve(buildRoot, "jspi-pthread");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "toolchain-build-info-"));
  const testArtifacts = resolve(temporaryRoot, "jspi-pthread");
  mkdirSync(testArtifacts);

  try {
    for (const name of [
      "openFPGALoader.mjs",
      "openFPGALoader.wasm",
      "build-info.json",
    ]) {
      cpSync(resolve(sourceArtifacts, name), resolve(testArtifacts, name));
    }
    const infoPath = resolve(testArtifacts, "build-info.json");
    const originalInfo = readFileSync(infoPath, "utf8");
    const cases = [
      {
        name: "missing metadata",
        expected: /Required build metadata is missing/,
        mutate: null,
      },
      {
        name: "non-C variant",
        expected: /Build metadata variant must be C/,
        mutate: (info) => {
          info.variant = "tampered";
        },
      },
      {
        name: "script hash mismatch",
        expected: /Build metadata field 'build_script_sha256' does not match/,
        mutate: (info) => {
          info.build_script_sha256 = "0".repeat(64);
        },
      },
      {
        name: "submodule hash mismatch",
        expected: /Build metadata field 'submodule_shas' does not match/,
        mutate: (info) => {
          info.submodule_shas["vendor/libusb"] = "0".repeat(40);
        },
      },
      {
        name: "artifact hash mismatch",
        expected: /Build metadata field 'artifacts' does not match/,
        mutate: (info) => {
          info.artifacts["openFPGALoader.wasm"] = "0".repeat(64);
        },
      },
    ];

    for (const { name, expected, mutate } of cases) {
      await t.test(name, () => {
        if (mutate) {
          const info = JSON.parse(originalInfo);
          mutate(info);
          writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`);
        } else {
          rmSync(infoPath, { force: true });
        }

        const result = spawnSync(
          "bash",
          [resolve(repoRoot, "scripts/build-web.sh")],
          {
            cwd: repoRoot,
            encoding: "utf8",
            env: {
              ...process.env,
              BUILD_ROOT: temporaryRoot,
            },
          },
        );
        const output = `${result.stdout}${result.stderr}`;
        assert.notEqual(result.status, 0, output);
        assert.match(output, expected);
      });
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
