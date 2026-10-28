import assert from "node:assert/strict";
import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOARDS } from "../../web/lib/boards.mjs";
import { fsIdcode, fsIdcodeMatchesBoard } from "../../web/lib/fs-idcode.mjs";
import { routeWorkerWithFakeUsb, stubPageUsb } from "./fake-usb-helpers.mjs";

const root = resolve(import.meta.dirname, "../..");
const expectedRoot = resolve(root, "build/e2e-expected");
const screenshots = resolve(root, "build/screenshots/s4");
mkdirSync(screenshots, { recursive: true });

async function createProject(page, board) {
  await page.goto("/");
  await expect(page.locator("#project-status")).toHaveText("保存しました。");
  const name = `s4-${board.id}-${randomUUID().slice(0, 8)}`;
  await page.locator("#new-project-button").click();
  await page.locator("#new-project-name").fill(name);
  await page.locator("#new-project-board").selectOption(board.id);
  await page.locator("#new-project-language").selectOption("verilog");
  await page.locator("#new-project-create").click();
  await expect(page.locator("#project-name")).toHaveText(name);
  await expect(page.locator("#synthesis-button")).toBeEnabled();
  return name;
}

async function storedFsDigest(page, projectName) {
  return page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const projects = await root.getDirectoryHandle("projects");
    const project = await projects.getDirectoryHandle(name);
    const build = await project.getDirectoryHandle("build");
    const file = await build.getFileHandle("top.fs");
    const bytes = await (await file.getFile()).arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return {
      size: bytes.byteLength,
      sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    };
  }, projectName);
}

for (const board of BOARDS) {
  test(`browser build matches native .fs for ${board.id}`, async ({ page }) => {
    await stubPageUsb(page);
    const projectName = await createProject(page, board);
    await page.evaluate(() => {
      window.__s4BuildResults = [];
      window.addEventListener("toolchain:build-complete", ({ detail }) => {
        window.__s4BuildResults.push(detail);
      });
    });
    const expectedBytes = readFileSync(resolve(expectedRoot, `${board.id}.fs`));
    const expectedHash = createHash("sha256").update(expectedBytes).digest("hex");
    const expectedIdcode = fsIdcode(expectedBytes.toString("utf8"));
    assert.ok(fsIdcodeMatchesBoard(expectedIdcode, board));
    for (let repeat = 0; repeat < 5; repeat += 1) {
      if (repeat > 0) await expect(page.locator("#program-button")).toBeEnabled();
      await page.locator("#synthesis-button").click();
      await expect(page.locator("#synthesis-button")).toHaveText("中止");
      await expect(page.locator("#program-button")).toBeDisabled();
      await expect(page.locator("#synthesis-stage")).toHaveText("ビルド完了", {
        timeout: 140_000,
      });
      await expect(page.locator("#fs-source")).toHaveValue("build/top.fs");
      const actual = await storedFsDigest(page, projectName);
      expect(actual).toEqual({
        size: expectedBytes.length,
        sha256: expectedHash,
      });
      if (repeat === 0) {
        await page.locator("#bottom-tab-log").click();
        await page.screenshot({
          path: resolve(screenshots, `${board.id}-success-log.png`),
        });
        await page.locator("#bottom-tab-artifacts").click();
        await page.screenshot({
          path: resolve(screenshots, `${board.id}-success-artifacts.png`),
        });
      }
      const [measurement] = await page.evaluate(() =>
        window.__s4BuildResults.splice(0, 1),
      );
      expect(measurement).toBeTruthy();
      console.log(
        `S4_BROWSER_METRIC ${JSON.stringify({
          board: board.id,
          repeat: repeat + 1,
          ...measurement,
        })}`,
      );
    }
    let writeWorkerRequests = 0;
    await routeWorkerWithFakeUsb(page, {
      idcode: board.idcode,
      onWorkerRequest: () => {
        writeWorkerRequests += 1;
      },
    });
    await expect(page.locator("#program-button")).toBeEnabled();
    await page.locator("#program-button").click();
    await expect(page.locator("#result-status")).toHaveText("成功", {
      timeout: 30_000,
    });
    await expect(page.locator("#program-log")).toContainText("Load SRAM");
    expect(writeWorkerRequests).toBe(1);
  });
}

test("missing chipdb fails asset integrity before placement and routing", async ({
  page,
}) => {
  const board = BOARDS[0];
  await createProject(page, board);
  await page.route("**/synth/chipdb/chipdb-GW1NZ-1.bin.zst", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/octet-stream",
      body: "",
    }),
  );
  await page.locator("#synthesis-button").click();
  await expect(page.locator("#synthesis-stage")).toHaveText("ビルド失敗", {
    timeout: 30_000,
  });
  await expect(page.locator("#program-log")).toContainText(
    "Could not load synthesis asset chipdb/chipdb-GW1NZ-1.bin (404)",
  );
});

test("corrupted compressed synthesis asset fails its SHA-256 check", async ({
  page,
}) => {
  await createProject(page, BOARDS[0]);
  const compressed = Buffer.from(
    readFileSync(resolve(root, "dist/synth/yosys.wasm.zst")),
  );
  compressed[Math.floor(compressed.byteLength / 2)] ^= 1;
  await page.route("**/synth/yosys.wasm.zst", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: compressed,
    }),
  );
  await page.locator("#synthesis-button").click();
  await expect(page.locator("#synthesis-stage")).toHaveText("ビルド失敗", {
    timeout: 30_000,
  });
  await expect(page.locator("#program-log")).toContainText(
    "Synthesis asset compressed SHA-256 mismatch for yosys.wasm",
  );
});

test("corrupted cached synthesis asset is discarded and refetched", async ({
  page,
}) => {
  await createProject(page, BOARDS[0]);
  const manifest = JSON.parse(
    readFileSync(resolve(root, "dist/synth/manifest.json"), "utf8"),
  );
  const asset = manifest.assets.find(({ path }) => path === "yosys.wasm");
  await page.evaluate(async (sha256) => {
    const cache = await caches.open("gogo-fpga-synth-v1");
    const key = new URL(`synth/yosys.wasm?sha256=${sha256}`, location.href);
    await cache.put(
      key,
      new Response("corrupt cached content", {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
  }, asset.sha256);
  let compressedRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(".zst")) compressedRequests += 1;
  });
  await page.locator("#synthesis-button").click();
  await expect(page.locator("#synthesis-stage")).toHaveText("ビルド完了", {
    timeout: 140_000,
  });
  expect(compressedRequests).toBe(4);
});

test("cached synthesis assets survive a page reload", async ({ page }) => {
  const board = BOARDS[0];
  const projectName = await createProject(page, board);
  const expectedBytes = readFileSync(resolve(expectedRoot, `${board.id}.fs`));
  await page.locator("#synthesis-button").click();
  await expect(page.locator("#synthesis-stage")).toHaveText("ビルド完了", {
    timeout: 140_000,
  });
  const firstResult = await storedFsDigest(page, projectName);
  await page.reload();
  await expect(
    page.locator(`#project-select option[value="${projectName}"]`),
  ).toBeAttached();
  await page.locator("#project-select").selectOption(projectName);
  await expect(page.locator("#project-name")).toHaveText(projectName);

  let compressedRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(".zst")) compressedRequests += 1;
  });
  await page.locator("#synthesis-button").click();
  await expect(page.locator("#synthesis-stage")).toHaveText("ビルド完了", {
    timeout: 140_000,
  });
  expect(await storedFsDigest(page, projectName)).toEqual(firstResult);
  expect(firstResult.size).toBe(expectedBytes.length);
  expect(compressedRequests).toBe(0);
});

test("cancelled browser build can be followed by a successful build", async ({
  page,
}) => {
  await createProject(page, BOARDS[0]);
  await page.locator("#synthesis-button").click();
  await expect(page.locator("#synthesis-stage")).toHaveText("合成", {
    timeout: 10_000,
  });
  await page.screenshot({ path: resolve(screenshots, "mid-build.png") });
  await page.locator("#synthesis-button").click();
  await expect(page.locator("#synthesis-stage")).toHaveText("中止しました");
  await page.unrouteAll();
  await page.locator("#synthesis-button").click();
  await expect(page.locator("#synthesis-stage")).toHaveText("ビルド完了", {
    timeout: 140_000,
  });
});

test("390 pixel layout stays usable during and after a browser build", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createProject(page, BOARDS[0]);
  await page.locator("#synthesis-button").click();
  await expect(page.locator("#synthesis-stage")).not.toBeEmpty();
  await page.screenshot({ path: resolve(screenshots, "390px-during.png") });
  await expect(page.locator("#synthesis-stage")).toHaveText("ビルド完了", {
    timeout: 140_000,
  });
  await page.screenshot({ path: resolve(screenshots, "390px-after.png") });
});
