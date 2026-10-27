import assert from "node:assert/strict";
import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { routeWorkerWithFakeUsb, stubPageUsb } from "./fake-usb-helpers.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");
const fixture = resolve(repoRoot, "build/fixtures/tangnano9k.fs");
const fixture20k = resolve(repoRoot, "build/fixtures/tangnano20k.fs");
const screenshots = resolve(repoRoot, "build/screenshots");
mkdirSync(screenshots, { recursive: true });

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function assertPackMatchesBuild() {
  const buildPackRoot = resolve(repoRoot, "build/pack");
  const distRoot = resolve(repoRoot, "dist");
  const distPackRoot = resolve(distRoot, "pack");
  const buildPackPaths = new Set(
    listFiles(buildPackRoot).map((path) => relative(buildPackRoot, path)),
  );
  const distPackPaths = new Set(
    listFiles(distPackRoot).map((path) => relative(distPackRoot, path)),
  );

  for (const path of distPackPaths) {
    if (!buildPackPaths.has(path)) {
      throw new Error(`Playwright preflight: unexpected dist/pack/${path}`);
    }
  }

  for (const path of buildPackPaths) {
    if (!distPackPaths.has(path)) {
      throw new Error(`Playwright preflight: dist/pack/${path} is missing`);
    }
    if (
      !readFileSync(resolve(buildPackRoot, path)).equals(
        readFileSync(resolve(distPackRoot, path)),
      )
    ) {
      throw new Error(
        `Playwright preflight: dist/pack/${path} differs from build/pack/${path}`,
      );
    }
  }

  return new Set(
    [...distPackPaths].map((path) =>
      relative(distRoot, resolve(distPackRoot, path)),
    ),
  );
}

function assertSynthMatchesBuild() {
  const buildRoot = resolve(repoRoot, process.env.BUILD_ROOT ?? "build");
  const buildSynthRoot = resolve(buildRoot, "synth");
  const distRoot = resolve(repoRoot, "dist");
  const distSynthRoot = resolve(distRoot, "synth");
  const buildSynthPaths = new Set(
    listFiles(buildSynthRoot).map((path) =>
      relative(buildSynthRoot, path),
    ),
  );
  const distSynthPaths = new Set(
    listFiles(distSynthRoot).map((path) =>
      relative(distSynthRoot, path),
    ),
  );

  for (const path of distSynthPaths) {
    if (!buildSynthPaths.has(path)) {
      throw new Error(`Playwright preflight: unexpected dist/synth/${path}`);
    }
  }

  for (const path of buildSynthPaths) {
    if (!distSynthPaths.has(path)) {
      throw new Error(`Playwright preflight: dist/synth/${path} is missing`);
    }
    if (
      !readFileSync(resolve(buildSynthRoot, path)).equals(
        readFileSync(resolve(distSynthRoot, path)),
      )
    ) {
      throw new Error(
        `Playwright preflight: dist/synth/${path} differs from ` +
          `${relative(repoRoot, buildSynthRoot)}/${path}`,
      );
    }
  }

  return new Set(
    [...distSynthPaths].map((path) =>
      relative(distRoot, resolve(distSynthRoot, path)),
    ),
  );
}

function assertDistributionMatchesSources() {
  const webRoot = resolve(repoRoot, "web");
  const distRoot = resolve(repoRoot, "dist");
  const sourcePaths = new Set();
  for (const sourcePath of listFiles(webRoot)) {
    const path = relative(webRoot, sourcePath);
    sourcePaths.add(path);
    const distPath = resolve(distRoot, path);
    let distContents;
    try {
      distContents = readFileSync(distPath);
    } catch (error) {
      throw new Error(`Playwright preflight: dist/${path} is missing`, {
        cause: error,
      });
    }
    if (!readFileSync(sourcePath).equals(distContents)) {
      throw new Error(`Playwright preflight: dist/${path} differs from web/${path}`);
    }
  }

  const generatedFileAllowlist = new Set([
    "editor/editor.bundle.mjs",
    "lib/project-zip.bundle.mjs",
  ]);
  const runtimeFiles = new Set([
    "build-info.json",
    "openFPGALoader.mjs",
    "openFPGALoader.wasm",
  ]);
  const packPaths = assertPackMatchesBuild();
  const synthPaths = assertSynthMatchesBuild();
  const distPaths = new Set(
    listFiles(distRoot).map((path) => relative(distRoot, path)),
  );
  for (const path of distPaths) {
    if (sourcePaths.has(path) || runtimeFiles.has(path)) continue;
    if (generatedFileAllowlist.delete(path)) continue;
    if (packPaths.delete(path)) continue;
    if (synthPaths.delete(path)) continue;
    throw new Error(`Playwright preflight: unexpected dist/${path}`);
  }
  if (generatedFileAllowlist.size > 0) {
    throw new Error(
      `Playwright preflight: generated-file allowlist was unused: ` +
        [...generatedFileAllowlist].join(", "),
    );
  }
  if (packPaths.size > 0) {
    throw new Error(
      `Playwright preflight: dist/${packPaths.values().next().value} is missing`,
    );
  }
  if (synthPaths.size > 0) {
    throw new Error(
      `Playwright preflight: dist/${synthPaths.values().next().value} is missing`,
    );
  }
  for (const path of runtimeFiles) {
    if (!distPaths.has(path)) {
      throw new Error(`Playwright preflight: dist/${path} is missing`);
    }
  }

  const buildRoot = resolve(repoRoot, process.env.BUILD_ROOT ?? "build");
  const buildWasm = resolve(buildRoot, "jspi-pthread/openFPGALoader.wasm");
  const distWasm = resolve(distRoot, "openFPGALoader.wasm");
  const buildHash = sha256(readFileSync(buildWasm));
  const distHash = sha256(readFileSync(distWasm));
  if (distHash !== buildHash) {
    throw new Error(
      `Playwright preflight: dist/openFPGALoader.wasm SHA-256 ${distHash} ` +
        `does not match ${relative(repoRoot, buildWasm)} SHA-256 ${buildHash}`,
    );
  }
}

async function openSupportedPage(page) {
  await stubPageUsb(page);
  await page.goto("/");
  await expect(page.locator("#support-status")).toHaveText(
    "このブラウザーを利用できます。",
  );
  await expect(page.locator("#project-status")).toHaveText("保存しました。");
}

test("built distribution matches sources and the build-root WASM", () => {
  assertDistributionMatchesSources();

  const packRoot = resolve(repoRoot, "dist/pack");
  const extraPath = resolve(packRoot, `.preflight-extra-${randomUUID()}`);
  try {
    writeFileSync(extraPath, "unexpected");
    assert.throws(
      () => assertDistributionMatchesSources(),
      /unexpected dist\/pack\/\.preflight-extra-/,
    );
  } finally {
    rmSync(extraPath, { force: true });
  }

  const lockPath = resolve(packRoot, "pyodide/pyodide-lock.json");
  const originalLock = readFileSync(lockPath);
  const alteredLock = Buffer.from(originalLock);
  alteredLock[0] ^= 1;
  try {
    writeFileSync(lockPath, alteredLock);
    assert.throws(
      () => assertDistributionMatchesSources(),
      /dist\/pack\/pyodide\/pyodide-lock\.json differs from build\/pack\/pyodide\/pyodide-lock\.json/,
    );
  } finally {
    writeFileSync(lockPath, originalLock);
  }

  const synthRoot = resolve(repoRoot, "dist/synth");
  const extraSynthPath = resolve(
    synthRoot,
    `.preflight-extra-${randomUUID()}`,
  );
  try {
    writeFileSync(extraSynthPath, "unexpected");
    assert.throws(
      () => assertDistributionMatchesSources(),
      /unexpected dist\/synth\/\.preflight-extra-/,
    );
  } finally {
    rmSync(extraSynthPath, { force: true });
  }

  const manifestPath = resolve(synthRoot, "manifest.json");
  const originalManifest = readFileSync(manifestPath);
  const alteredManifest = Buffer.from(originalManifest);
  alteredManifest[0] ^= 1;
  try {
    writeFileSync(manifestPath, alteredManifest);
    assert.throws(
      () => assertDistributionMatchesSources(),
      /dist\/synth\/manifest\.json differs from build\/(?:.*\/)?synth\/manifest\.json/,
    );
  } finally {
    writeFileSync(manifestPath, originalManifest);
  }
});

test("support check passes and the page renders", async ({ page }) => {
  await openSupportedPage(page);
  await expect(page.locator("#board-select option")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "書き込む" })).toBeDisabled();
  await expect(page.locator("#fs-source")).toHaveValue("local");
  await expect(page.locator("#command-preview")).toHaveText(
    "openFPGALoader -b tangnano1k /input.fs",
  );
  await expect(page.locator("#run-panel")).toBeHidden();
  await page.screenshot({
    path: resolve(screenshots, "initial.png"),
    fullPage: true,
  });
});

test("9K SRAM programming succeeds and reports progress", async ({ page }) => {
  let workerRequests = 0;
  await routeWorkerWithFakeUsb(page, {
    onWorkerRequest: () => {
      workerRequests += 1;
    },
  });
  await openSupportedPage(page);
  await page.locator("#board-select").selectOption("tangnano9k");
  await page.locator("#bitstream-file").setInputFiles(fixture);
  await page.getByRole("button", { name: "書き込む" }).click();

  await expect(page.locator("#result-status")).toHaveText("成功", {
    timeout: 30_000,
  });
  await expect(page.locator("#command-preview")).toHaveText(
    "openFPGALoader -b tangnano9k /input.fs",
  );
  await expect(page.locator("#program-log")).toContainText("Load SRAM");
  await expect(page.locator("#progress-bar")).toHaveJSProperty("value", 100);
  await expect(page.locator("#support-status")).toHaveText(
    "このブラウザーを利用できます。",
  );
  expect(await page.evaluate(() => window.__usbRequestOptions.filters)).toEqual([
    { vendorId: 0x0403, productId: 0x6010 },
  ]);
  expect(workerRequests).toBe(1);
  await page.screenshot({
    path: resolve(screenshots, "success.png"),
    fullPage: true,
  });
});

test("DONE never set is reported as failure despite exit zero", async ({ page }) => {
  await routeWorkerWithFakeUsb(page, { faults: { doneNever: true } });
  await openSupportedPage(page);
  await page.locator("#board-select").selectOption("tangnano9k");
  await page.locator("#bitstream-file").setInputFiles(fixture);
  await page.getByRole("button", { name: "書き込む" }).click();

  await expect(page.locator("#result-status")).toHaveText("失敗：書き込み失敗", {
    timeout: 30_000,
  });
  await expect(page.locator("#program-log")).toContainText("FAIL");
  await expect(page.locator("#support-status")).toHaveText(
    "このブラウザーを利用できます。",
  );
  await page.screenshot({
    path: resolve(screenshots, "failure.png"),
    fullPage: true,
  });
});

test("IDCODE mismatch requires confirmation and cancel stops the run", async ({
  page,
}) => {
  let workerRequests = 0;
  await routeWorkerWithFakeUsb(page, {
    onWorkerRequest: () => {
      workerRequests += 1;
    },
  });
  await openSupportedPage(page);
  await page.locator("#board-select").selectOption("tangnano1k");
  await page.locator("#bitstream-file").setInputFiles(fixture);
  await page.getByRole("button", { name: "書き込む" }).click();

  const dialog = page.locator("#idcode-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("一致しません");
  await expect(dialog).toContainText("0x0100681b");
  await expect(dialog).toContainText("0x0100481b");
  await expect(dialog).toContainText("生の値 0x1100481b");
  await expect(dialog.locator("#idcode-warning")).toHaveText(
    "Tang Nano 1K の IDCODE 0x0100681b と、ファイルの IDCODE 0x0100481b（生の値 0x1100481b）は一致しません。",
  );
  await expect(page.locator("#run-panel")).toBeHidden();
  await page.screenshot({
    path: resolve(screenshots, "mismatch-warning.png"),
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#run-panel")).toBeHidden();
  await expect(page.locator("#support-status")).toHaveText(
    "このブラウザーを利用できます。",
  );
  expect(await page.evaluate(() => window.__usbRequestCount ?? 0)).toBe(0);
  expect(workerRequests).toBe(0);
});

test("IDCODE mismatch confirmation requests a device after Continue", async ({
  page,
}) => {
  let workerRequests = 0;
  await routeWorkerWithFakeUsb(page, {
    onWorkerRequest: () => {
      workerRequests += 1;
    },
  });
  await openSupportedPage(page);
  await page.locator("#board-select").selectOption("tangnano1k");
  await page.locator("#bitstream-file").setInputFiles(fixture);
  await page.getByRole("button", { name: "書き込む" }).click();

  const dialog = page.locator("#idcode-dialog");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.__usbRequestCount ?? 0)).toBe(0);
  await dialog.getByRole("button", { name: "続行する" }).click();

  await expect(page.locator("#result-status")).toHaveText("成功", {
    timeout: 30_000,
  });
  expect(await page.evaluate(() => window.__usbRequestOptions.filters)).toEqual([
    { vendorId: 0x0403, productId: 0x6010 },
  ]);
  expect(workerRequests).toBe(1);
});

test("20K flash programming succeeds with verification", async ({ page }) => {
  await routeWorkerWithFakeUsb(page, { idcode: 0x0000081b });
  await openSupportedPage(page);
  await page.locator("#board-select").selectOption("tangnano20k");
  await page.locator("#bitstream-file").setInputFiles(fixture20k);
  await page.locator('input[name="target"][value="flash"]').check();

  await expect(page.locator("#command-preview")).toHaveText(
    "openFPGALoader -b tangnano20k -f --verify /input.fs",
  );
  await page.getByRole("button", { name: "書き込む" }).click();
  try {
    await expect(page.locator("#result-status")).toHaveText("成功", {
      timeout: 30_000,
    });
  } catch (error) {
    error.message += `\nProgram log:\n${await page.locator("#program-log").textContent()}`;
    throw error;
  }
  await expect(page.locator("#progress-bar")).toHaveJSProperty("value", 100);
  await page.screenshot({
    path: resolve(screenshots, "flash-20k.png"),
    fullPage: true,
  });
});

test("command preview updates when board and target change", async ({ page }) => {
  await openSupportedPage(page);
  const preview = page.locator("#command-preview");

  await page.locator("#board-select").selectOption("tangnano20k");
  await expect(preview).toHaveText(
    "openFPGALoader -b tangnano20k /input.fs",
  );
  await page.locator('input[name="target"][value="flash"]').check();
  await expect(preview).toHaveText(
    "openFPGALoader -b tangnano20k -f --verify /input.fs",
  );
  await page.locator("#board-select").selectOption("tangnano1k");
  await expect(preview).toHaveText(
    "openFPGALoader -b tangnano1k -f /input.fs",
  );
  await expect(preview).not.toContainText("--verify");
});

test("advanced settings screenshots cover all supported boards", async ({ page }) => {
  await openSupportedPage(page);
  const advanced = page.locator("#advanced-settings");
  await advanced.locator("summary").click();

  for (const board of ["tangnano1k", "tangnano4k", "tangnano9k", "tangnano20k"]) {
    await page.locator("#board-select").selectOption(board);
    await page.locator('input[name="target"][value="flash"]').check();
    await expect(page.locator("#flash-write-warning")).toBeVisible();
    await expect(page.locator("#flash-erase-warning")).toBeHidden();
    await expect(advanced).toBeVisible();
    await page.screenshot({
      path: resolve(screenshots, `advanced-${board}.png`),
      fullPage: true,
    });
  }

  await page.locator("#board-select").selectOption("tangnano1k");
  await expect(page.locator('input[name="flash-type"][value="external"]')).toBeDisabled();
  await expect(page.locator("#external-flash-reason")).toHaveText(
    "外付けフラッシュが実装されていません。",
  );
  await expect(page.locator("#protect-option")).toBeDisabled();
  await expect(page.locator("#protect-reason")).toContainText(
    "対応していません",
  );

  await page.locator("#board-select").selectOption("tangnano20k");
  await page.locator('input[name="operation"][value="dump"]').check();
  await expect(page.locator("#flash-write-warning")).toBeHidden();
  await expect(page.locator("#dump-operation-hint")).toBeVisible();
  await page.locator('input[name="operation"][value="erase"]').check();
  await expect(page.locator("#flash-erase-warning")).toBeVisible();
  await expect(page.locator("#erase-operation-hint")).toBeVisible();
});

test("verify toggle updates the preview and worker arguments", async ({ page }) => {
  await routeWorkerWithFakeUsb(page, { idcode: 0x0000081b });
  await openSupportedPage(page);
  await page.locator("#board-select").selectOption("tangnano20k");
  await page.locator("#bitstream-file").setInputFiles(fixture20k);
  await page.locator('input[name="target"][value="flash"]').check();
  await page.locator("#advanced-settings summary").click();
  await page.locator('input[name="flash-type"][value="external"]').check();
  const verify = page.locator("#verify-option");
  await expect(verify).toBeChecked();
  await expect(page.locator("#command-preview")).toContainText("--verify");

  await page.getByRole("button", { name: "書き込む" }).click();
  await expect(page.locator("#result-status")).toHaveText("成功", {
    timeout: 30_000,
  });
  const verifiedArgs = await page.evaluate(() => window.__workerMessages[0].args);
  expect(verifiedArgs).toContain("--verify");

  await verify.uncheck();
  await expect(page.locator("#command-preview")).not.toContainText("--verify");
  await page.getByRole("button", { name: "書き込む" }).click();
  await expect.poll(
    () => page.evaluate(() => window.__workerMessages?.length ?? 0),
  ).toBe(2);
  await expect(page.locator("#result-status")).toHaveText("成功", {
    timeout: 30_000,
  });
  const unverifiedArgs = await page.evaluate(() => window.__workerMessages[1].args);
  expect(unverifiedArgs).not.toContain("--verify");
});

test("erase confirmation cancel and Escape never request USB", async ({ page }) => {
  await openSupportedPage(page);
  await page.locator("#board-select").selectOption("tangnano20k");
  await page.locator("#advanced-settings summary").click();
  await page.locator('input[name="operation"][value="erase"]').check();
  const runButton = page.getByRole("button", { name: "消去する" });
  await runButton.click();
  const dialog = page.locator("#erase-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Tang Nano 20K");
  await expect(dialog).toContainText("フラッシュの内容がすべて消えます");
  await expect(page.locator("#flash-write-warning")).toBeHidden();
  await expect(page.locator("#flash-erase-warning")).toBeVisible();
  await expect(page.locator("#erase-operation-hint")).toBeVisible();
  await expect(dialog.locator("#erase-cancel")).toBeFocused();
  await expect(dialog.locator("#erase-confirm")).toHaveClass(/danger/);
  await page.screenshot({
    path: resolve(screenshots, "erase-dialog.png"),
    fullPage: false,
  });
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__usbRequestCount ?? 0)).toBe(0);

  await runButton.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__usbRequestCount ?? 0)).toBe(0);
  await expect(page.locator("#run-panel")).toBeHidden();
});

test("confirmed erase requests USB and completes", async ({ page }) => {
  await routeWorkerWithFakeUsb(page, { idcode: 0x0000081b });
  await openSupportedPage(page);
  await page.locator("#board-select").selectOption("tangnano20k");
  await page.locator("#advanced-settings summary").click();
  await page.locator('input[name="operation"][value="erase"]').check();
  await page.getByRole("button", { name: "消去する" }).click();
  await page.locator("#erase-confirm").click();
  await expect(page.locator("#result-status")).toHaveText("成功", {
    timeout: 30_000,
  });
  expect(await page.evaluate(() => window.__usbRequestCount)).toBe(1);
  expect(await page.evaluate(() => window.__workerMessages[0].args)).toEqual([
    "-b",
    "tangnano20k",
    "--bulk-erase",
  ]);
});

test("dump download contains the requested external-flash bytes", async ({ page }) => {
  const offset = 0x100;
  const expected = [0x12, 0x34, 0x56, 0x78];
  await routeWorkerWithFakeUsb(page, {
    idcode: 0x1100481b,
    faults: { norSeed: { offset, bytes: expected } },
  });
  await openSupportedPage(page);
  await page.locator("#board-select").selectOption("tangnano9k");
  await page.locator("#advanced-settings summary").click();
  await page.locator('input[name="operation"][value="dump"]').check();
  await expect(page.locator("#flash-write-warning")).toBeHidden();
  await expect(page.locator("#flash-erase-warning")).toBeHidden();
  await expect(page.locator("#dump-operation-hint")).toBeVisible();
  await page.locator('input[name="dump-size"][value="custom"]').check();
  await page.locator("#dump-size-bytes").fill(String(expected.length));
  await page.locator("#offset-option").fill(String(offset));
  await expect(page.locator("#command-preview")).toHaveText(
    "openFPGALoader -b tangnano9k --external-flash --dump-flash --file-size 4 -o 256 /dump.bin",
  );

  await page.getByRole("button", { name: "読み出す" }).click();
  await expect(page.locator("#result-status")).toHaveText("成功", {
    timeout: 30_000,
  });
  await expect(page.locator("#dump-download")).toHaveAttribute(
    "download",
    "tangnano9k-flash-0x100-4.bin",
  );
  await page.screenshot({
    path: resolve(screenshots, "dump-result.png"),
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#dump-download").click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(Array.from(readFileSync(path))).toEqual(expected);
  expect(await page.evaluate(() => window.__workerMessages[0].outputs)).toEqual([
    "/dump.bin",
  ]);
});

test("invalid external-flash offset blocks the write", async ({ page }) => {
  await openSupportedPage(page);
  await page.locator("#board-select").selectOption("tangnano9k");
  await page.locator("#bitstream-file").setInputFiles(fixture);
  await page.locator('input[name="target"][value="flash"]').check();
  await page.locator("#advanced-settings summary").click();
  await page.locator('input[name="flash-type"][value="external"]').check();
  await page.locator("#offset-option").fill("0x400000");
  await expect(page.locator("#validation-errors")).toContainText(
    "フラッシュ容量を超えています",
  );
  await expect(page.getByRole("button", { name: "書き込む" })).toBeDisabled();
  expect(await page.evaluate(() => window.__usbRequestCount ?? 0)).toBe(0);
});

test("unsupported browser shows a message and keeps the button disabled", async ({
  page,
}) => {
  await stubPageUsb(page, true);
  await page.goto("/");

  await expect(page.locator("#support-status")).toContainText(
    "このブラウザーでは操作できません。足りない機能：",
  );
  await expect(page.getByRole("button", { name: "書き込む" })).toBeDisabled();
  await page.screenshot({
    path: resolve(screenshots, "unsupported.png"),
    fullPage: true,
  });
});

const templateWriteCases = [
  { board: "tangnano1k", idcode: 0x0100681b },
  { board: "tangnano4k", idcode: 0x0100981b },
  { board: "tangnano9k", idcode: 0x1100481b },
  { board: "tangnano20k", idcode: 0x0000081b },
];

async function createTemplateProject(page, name, board, language = "verilog") {
  await page.locator("#new-project-button").click();
  await page.locator("#new-project-name").fill(name);
  await page.locator("#new-project-board").selectOption(board);
  await page.locator("#new-project-language").selectOption(language);
  await page.locator("#new-project-create").click();
  await expect(page.locator("#project-name")).toHaveText(name);
  await expect(page.locator("#project-status")).toHaveText("保存しました。");
}

async function uploadProjectBitstream(page, fixturePath, board) {
  const path = `artifacts/${board}.fs`;
  await expect(page.locator("#use-bitstream-button")).toHaveCount(0);
  await page.locator("#add-file-button").click();
  await page.locator("#file-path-input").fill(path);
  await page.locator("#file-content-input").setInputFiles(fixturePath);
  await page.locator("#file-path-save").click();
  await expect(page.locator("#fs-source")).toHaveValue(path);
  await expect(page.locator("#fs-file-info")).toContainText("読み取り専用");
  await expect(page.locator("#fs-file-info")).toContainText("サイズ:");
  await expect(page.locator(".cm-content")).toContainText("module top");
  await expect(page.locator("#project-status")).toHaveText("保存しました。", {
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "書き込む" })).toBeEnabled({
    timeout: 10_000,
  });
}

for (const { board, idcode } of templateWriteCases) {
  test(`${board} template writes a project .fs through the existing path`, async ({
    page,
  }) => {
    const fixturePath = resolve(repoRoot, `build/fixtures/${board}.fs`);
    await routeWorkerWithFakeUsb(page, { idcode });
    await openSupportedPage(page);
    await createTemplateProject(page, `template-${board}`, board);
    await uploadProjectBitstream(page, fixturePath, board);
    await expect(page.locator("#local-fs-field")).toBeHidden();
    await page.locator('input[name="target"][value="sram"]').check();
    await page.getByRole("button", { name: "書き込む" }).click();

    await expect(page.locator("#result-status")).toHaveText("成功", {
      timeout: 30_000,
    });
    await expect(page.locator("#command-preview")).toContainText(
      `-b ${board} /input.fs`,
    );
  });
}

test("a project .fs for another board is rejected by IDCODE validation", async ({
  page,
}) => {
  let workerRequests = 0;
  await routeWorkerWithFakeUsb(page, {
    idcode: 0x0100681b,
    onWorkerRequest: () => {
      workerRequests += 1;
    },
  });
  await openSupportedPage(page);
  await createTemplateProject(page, "wrong-board", "tangnano1k");
  await uploadProjectBitstream(page, fixture, "tangnano9k");
  await page.getByRole("button", { name: "書き込む" }).click();

  await expect(page.locator("#idcode-dialog")).toBeVisible();
  await expect(page.locator("#idcode-dialog")).toContainText("一致しません");
  expect(workerRequests).toBe(0);
});

test("project ZIP export and import preserve all project file bytes", async ({
  page,
}) => {
  const projectName = "zip-roundtrip";
  await openSupportedPage(page);
  await createTemplateProject(page, projectName, "tangnano9k");
  await uploadProjectBitstream(page, fixture, "tangnano9k");

  const readProject = () =>
    page.evaluate(async (name) => {
      const { createOpfsStore } = await import("/lib/project-store.mjs");
      const { project, files } = await createOpfsStore(
        navigator.storage,
      ).load(name);
      return {
        project,
        files: [...files]
          .map(([path, content]) => [
            path,
            Array.from(
              typeof content === "string"
                ? new TextEncoder().encode(content)
                : content,
            ),
          ])
          .sort(([left], [right]) => left.localeCompare(right)),
      };
    }, projectName);

  const before = await readProject();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-project-button").click();
  const download = await downloadPromise;
  const zipPath = await download.path();
  await page.locator("#import-project-button").click();
  await page.locator("#project-zip-input").setInputFiles(zipPath);
  await expect(page.locator("#project-action-status")).toHaveText(
    "同じ名前のプロジェクトがすでにあります。",
    { timeout: 10_000 },
  );
  expect(await readProject()).toEqual(before);

  await page.evaluate(async (name) => {
    const { createOpfsStore } = await import("/lib/project-store.mjs");
    await createOpfsStore(navigator.storage).remove(name);
  }, projectName);

  await page.locator("#import-project-button").click();
  await page.locator("#project-zip-input").setInputFiles([]);
  await page.locator("#project-zip-input").setInputFiles(zipPath);
  await expect(page.locator("#project-name")).toHaveText(projectName);
  await expect(page.locator("#project-action-status")).toHaveText(
    "ZIP ファイルを読み込みました。",
    { timeout: 10_000 },
  );
  expect(await readProject()).toEqual(before);
});

test("project switcher opens another saved project", async ({ page }) => {
  await openSupportedPage(page);
  await createTemplateProject(page, "switch-target", "tangnano4k");
  await expect(page.locator('#project-select option[value="blink"]')).toBeAttached();
  await page.locator("#project-select").selectOption("blink");
  await expect(page.locator("#project-name")).toHaveText("blink");
  await page.locator("#project-select").selectOption("switch-target");
  await expect(page.locator("#project-name")).toHaveText("switch-target");
  await expect(page.locator("#board-select")).toHaveValue("tangnano4k");
});

test("creating a project with an existing name does not overwrite it", async ({
  page,
}) => {
  await openSupportedPage(page);
  const originalText = await page.locator(".cm-content").innerText();
  await page.locator("#new-project-button").click();
  await page.locator("#new-project-name").fill("blink");
  await page.locator("#new-project-create").click();
  await expect(page.locator("#new-project-error")).toHaveText(
    "同じ名前のプロジェクトがすでにあります。",
  );
  await page.locator("#new-project-cancel").click();
  await expect(page.locator("#project-name")).toHaveText("blink");
  expect(await page.locator(".cm-content").innerText()).toBe(originalText);
});

test("projects with multiple .fs files default to the local file source", async ({
  page,
}) => {
  await openSupportedPage(page);
  await createTemplateProject(page, "multiple-fs", "tangnano9k");
  await uploadProjectBitstream(page, fixture, "tangnano9k");
  await page.locator("#add-file-button").click();
  await page.locator("#file-path-input").fill("artifacts/second.fs");
  await page.locator("#file-content-input").setInputFiles(fixture);
  await page.locator("#file-path-save").click();
  await expect(page.locator("#fs-source")).toHaveValue("local");
  await expect(page.locator("#local-fs-field")).toBeVisible();
});

test("changing a project's board preserves its generated constraints", async ({
  page,
}) => {
  await openSupportedPage(page);
  await createTemplateProject(page, "board-change", "tangnano1k");
  const originalConstraints = await page.evaluate(async () => {
    const { createOpfsStore } = await import("/lib/project-store.mjs");
    const { files } = await createOpfsStore(navigator.storage).load("board-change");
    return files.get("constraints/tangnano1k.cst");
  });
  await page.locator("#board-select").selectOption("tangnano4k");
  await expect(page.locator("#project-status")).toHaveText("保存しました。", {
    timeout: 10_000,
  });
  const updatedProject = await page.evaluate(async () => {
    const { createOpfsStore } = await import("/lib/project-store.mjs");
    const { project, files } = await createOpfsStore(
      navigator.storage,
    ).load("board-change");
    return {
      board: project.board,
      constraints: files.get("constraints/tangnano1k.cst"),
    };
  });
  expect(updatedProject.board).toBe("tangnano4k");
  expect(updatedProject.constraints).toEqual(originalConstraints);
});

test("VHDL project creation opens the generated VHDL source", async ({ page }) => {
  await openSupportedPage(page);
  await createTemplateProject(page, "vhdl-project", "tangnano9k", "vhdl");
  await expect(page.locator("#editor-tabs")).toContainText("top.vhd");
  await expect(page.locator(".cm-content")).toContainText(
    "library ieee;",
  );
});
