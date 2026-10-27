import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const screenshots = resolve(repoRoot, "build/screenshots");
mkdirSync(screenshots, { recursive: true });

async function openIde(page) {
  await page.goto("/");
  await expect(page.locator("#project-name")).toHaveText("blink");
  await expect(page.locator("#support-status")).toBeVisible();
}

test("IDE loads without console errors and highlights Verilog keywords", async ({
  page,
}) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await openIde(page);
  const moduleToken = page
    .locator(".cm-content span")
    .filter({ hasText: /^module$/ })
    .first();
  await expect(moduleToken).toBeVisible();
  expect(await moduleToken.getAttribute("class")).toBeTruthy();
  await expect(page.locator("#synthesis-button")).toBeDisabled();
  await expect(page.locator(".synthesis-reason")).toHaveText("T2 で対応予定です");
  expect(errors).toEqual([]);
});

test("Verilog autocomplete includes always", async ({ page }) => {
  await openIde(page);
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("alw");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("always");
});

test("editor changes persist through reload from OPFS", async ({ page }) => {
  await openIde(page);
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("module restored; endmodule");
  await expect(page.locator("#project-status")).toHaveText(
    "ローカルに保存しました。",
    { timeout: 10_000 },
  );
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("module restored");
});

test("file paths are validated with Japanese feedback", async ({ page }) => {
  await openIde(page);
  await page.locator("#add-file-button").click();
  await page.locator("#file-path-input").fill("../x.v");
  await page.locator("#file-path-save").click();
  await expect(page.locator("#file-path-error")).toContainText("パス");
  await expect(page.locator("#file-dialog")).toBeVisible();

  await page.locator("#file-path-input").fill("src/a.vhd");
  await page.locator("#file-path-save").click();
  await expect(page.locator("#file-list")).toContainText("src/a.vhd");
  await expect(page.locator("#editor-tabs")).toContainText("a.vhd");
});

test("narrow layout opens and closes both side panes", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await openIde(page);
  await expect(page.locator("#files-pane")).toBeHidden();
  await page.locator("#toggle-files-pane").click();
  await expect(page.locator("#files-pane")).toBeVisible();
  await page.locator("#close-files-pane").click();
  await expect(page.locator("#files-pane")).toBeHidden();
  await page.locator("#toggle-board-pane").click();
  await expect(page.locator("#board-pane")).toBeVisible();
  await page.locator("#close-board-pane").click();
  await expect(page.locator("#board-pane")).toBeHidden();
  await page.screenshot({
    path: resolve(screenshots, "ide-narrow.png"),
  });
});

test("board screenshots show the selected FPGA and IDCODE", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openIde(page);
  const boards = [
    ["tangnano1k", "GW1NZ-1", "0x0100681b"],
    ["tangnano4k", "GW1NSR-4C", "0x0100981b"],
    ["tangnano9k", "GW1N(R)-9C", "0x0100481b"],
    ["tangnano20k", "GW2A(R)-18(C)", "0x0000081b"],
  ];
  for (const [id, fpga, idcode] of boards) {
    await page.locator("#board-select").selectOption(id);
    await expect(page.locator("#board-fpga")).toHaveText(fpga);
    await expect(page.locator("#board-idcode")).toHaveText(idcode);
    await page.screenshot({
      path: resolve(screenshots, `ide-${id}.png`),
    });
  }
});

test("injected diagnostics show an editor marker and a Japanese problem row", async ({
  page,
}) => {
  await openIde(page);
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("toolchain:diagnostics", {
        detail: [{ from: 0, to: 6, severity: "error", message: "構文エラー" }],
      }),
    );
  });
  await page.locator("#bottom-tab-problems").click();
  await expect(page.locator("#problem-list")).toContainText("エラー: 構文エラー");
  await expect(page.locator(".cm-lintRange-error")).toBeVisible();
});
