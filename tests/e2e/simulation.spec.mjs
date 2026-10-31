import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dist = resolve(root, "dist");
const screenshots = resolve(root, "build/T4-ui/screens");
const finiteTestbench = [
  "`timescale 1ns/1ps",
  "module top_tb;",
  "  reg clk = 1'b0;",
  "  wire led;",
  "  top uut (.clk(clk), .led(led));",
  "  always #5 clk = ~clk;",
  "  initial begin",
  "    $dumpfile(\"wave.vcd\");",
  "    $dumpvars(0, top_tb);",
  "    #100;",
  "    $finish;",
  "  end",
  "endmodule",
].join("\n");
const infiniteTestbench = [
  "`timescale 1ns/1ps",
  "module top_tb;",
  "  reg clk = 1'b0;",
  "  wire led;",
  "  top uut (.clk(clk), .led(led));",
  "  always #5 clk = ~clk;",
  "  initial begin",
  "    $dumpfile(\"wave.vcd\");",
  "    $dumpvars(0, top_tb);",
  "  end",
  "endmodule",
].join("\n");
mkdirSync(screenshots, { recursive: true });

test.use({
  launchOptions: {
    args: ["--lang=ja-JP", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

function captureRequests(page) {
  const requests = [];
  page.on("request", (request) => {
    requests.push({ url: request.url(), method: request.method() });
  });
  return requests;
}

function assertStaticRequests(page, requests) {
  const origin = new URL(page.url()).origin;
  for (const { url: value, method } of requests) {
    const url = new URL(value);
    if (url.protocol === "blob:") {
      expect(url.origin).toBe(origin);
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol)) continue;
    expect(url.origin).toBe(origin);
    expect(method).toBe("GET");
    const path = decodeURIComponent(url.pathname);
    const relative = path === "/" ? "index.html" : path.slice(1);
    const file = resolve(dist, relative);
    expect(file.startsWith(`${dist}${sep}`)).toBe(true);
    expect(existsSync(file), `${path} must be present in dist`).toBe(true);
  }
}

async function openIde(page) {
  await page.goto("/");
  await expect(page.locator("#project-name")).toHaveText("blink");
  await expect(page.locator("#project-status")).toHaveText("保存しました。");
}

async function createProject(page, board, language = "verilog") {
  const name = `sim-${board}-${randomUUID().slice(0, 8)}`;
  await page.locator("#new-project-button").click();
  await page.locator("#new-project-name").fill(name);
  await page.locator("#new-project-board").selectOption(board);
  await page.locator("#new-project-language").selectOption(language);
  await page.locator("#new-project-create").click();
  await expect(page.locator("#project-name")).toHaveText(name);
  await expect(page.locator("#project-status")).toHaveText("保存しました。");
  return name;
}

async function replaceFile(page, path, contents) {
  await page.getByRole("button", { name: `${path} を開く` }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(contents);
  await expect(page.locator("#project-status")).toHaveText("保存しました。", {
    timeout: 10_000,
  });
}

async function waitForWaveform(page) {
  await page.locator("#bottom-tab-waveform").click();
  const frame = page.frames().find((candidate) =>
    candidate.url().endsWith("/surfer/index.html")
  );
  expect(frame).toBeTruthy();
  await expect.poll(
    () => frame.evaluate(async () => {
      const m = await import("/surfer/surfer.js");
      return m.waves_loaded();
    }),
    { timeout: 10_000 },
  ).toBe(true);
  await expect.poll(
    () => frame.evaluate(async () => {
      const m = await import("/surfer/surfer.js");
      return m.index_of_name("top_tb.clk");
    }),
    { timeout: 10_000 },
  ).toBeGreaterThanOrEqual(0);
  return frame;
}

test("each board template simulates and loads a top_tb waveform", async ({ page }) => {
  const requests = captureRequests(page);
  await openIde(page);
  for (const board of ["tangnano1k", "tangnano4k", "tangnano9k", "tangnano20k"]) {
    if (board !== "tangnano1k") {
      await page.goto("/");
      await openIde(page);
    }
    await createProject(page, board);
    await expect(page.locator("#simulation-button")).toBeEnabled();
    await page.locator("#simulation-button").click();
    await expect(page.locator("#simulation-status")).toHaveAttribute("data-outcome", "ok", {
      timeout: 30_000,
    });
    await expect(page.locator("#wave-download-link")).toHaveAttribute("download", "wave.vcd");
    await waitForWaveform(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(
      () => page.locator("#bottom-panel-waveform").evaluate((panel) =>
        panel.getBoundingClientRect().height
      ),
    ).toBeGreaterThanOrEqual(420);
    await page.locator("#bottom-panel-waveform").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(screenshots, `${board}-desktop.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(
      () => page.locator("#bottom-panel-waveform").evaluate((panel) =>
        panel.getBoundingClientRect().height
      ),
    ).toBeGreaterThanOrEqual(420);
    await page.locator("#bottom-panel-waveform").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(screenshots, `${board}-mobile.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  assertStaticRequests(page, requests);
});

test("Icarus syntax diagnostics point to the project file and source line", async ({ page }) => {
  const requests = captureRequests(page);
  await openIde(page);
  await replaceFile(
    page,
    "src/top.v",
    "`timescale 1ns/1ps\nmodule top;\n  wire a;\n  assign a = ;\nendmodule\n",
  );
  await page.locator("#simulation-button").click();
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-outcome", "failed", {
    timeout: 15_000,
  });
  await page.locator("#bottom-tab-problems").click();
  await expect(page.locator("#problem-list")).toContainText("src/top.v:4");
  await expect(page.locator("#problem-list")).toContainText("syntax error");
  assertStaticRequests(page, requests);
});

test("a successful run without VCD reports the dumpfile guidance", async ({ page }) => {
  const requests = captureRequests(page);
  await openIde(page);
  await replaceFile(
    page,
    "src/top_tb.v",
    "`timescale 1ns/1ps\nmodule top_tb;\n  initial begin\n    #10;\n    $finish;\n  end\nendmodule\n",
  );
  await page.locator("#simulation-button").click();
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-outcome", "failed", {
    timeout: 15_000,
  });
  await expect(page.locator("#program-log")).toContainText(
    "VCD が出力されていません。testbench の $dumpfile と $dumpvars を確かめてください。",
  );
  assertStaticRequests(page, requests);
});

test("stop terminates the worker, reruns successfully, and the time limit is enforced", async ({
  page,
}) => {
  const requests = captureRequests(page);
  await openIde(page);
  await replaceFile(page, "src/top_tb.v", infiniteTestbench);
  await page.locator("#simulation-button").click();
  await expect(page.locator("#simulation-button")).toHaveText("停止");
  await page.locator("#simulation-button").click();
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-outcome", "stopped", {
    timeout: 10_000,
  });
  await expect(page.locator("#simulation-button")).toHaveText("シミュレーション");
  await replaceFile(page, "src/top_tb.v", finiteTestbench);
  await page.locator("#simulation-button").click();
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-outcome", "ok", {
    timeout: 15_000,
  });
  await replaceFile(page, "src/top_tb.v", infiniteTestbench);
  await page.locator("#simulation-time-limit").fill("1");
  await page.locator("#simulation-time-limit").dispatchEvent("change");
  await page.locator("#simulation-button").click();
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-outcome", "timeout", {
    timeout: 10_000,
  });
  await expect(page.locator("#simulation-status")).toContainText("時間上限に達しました。");
  assertStaticRequests(page, requests);
});

test("VHDL-only is disabled and mixed projects log VHDL exclusion", async ({ page }) => {
  const requests = captureRequests(page);
  await openIde(page);
  await createProject(page, "tangnano1k", "vhdl");
  await expect(page.locator("#simulation-button")).toBeDisabled();
  await expect(page.locator("#simulation-reason")).toHaveText(
    "VHDL のシミュレーションはできません（Verilog の testbench を使ってください）",
  );
  await createProject(page, "tangnano1k", "verilog");
  await page.locator("#add-file-button").click();
  await page.locator("#file-path-input").fill("src/ignored.vhd");
  await page.locator("#file-path-save").click();
  await expect(page.locator("#file-list")).toContainText("src/ignored.vhd");
  await page.locator("#simulation-button").click();
  await expect(page.locator("#simulation-status")).toHaveAttribute("data-outcome", "ok", {
    timeout: 15_000,
  });
  await expect(page.locator("#program-log")).toContainText(
    "VHDL ファイルはシミュレーションから除外しました。",
  );
  assertStaticRequests(page, requests);
});
