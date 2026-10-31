import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const fixture = readFileSync(resolve(root, "tests/fixtures/surfer/logic.vcd"), "utf8");
const playwrightPort = process.env.PLAYWRIGHT_PORT ?? "8000";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${playwrightPort}`;

test.use({
  launchOptions: {
    args: ["--lang=ja-JP", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

async function openSurfer(page, vcd) {
  const origin = new URL(baseURL).origin;
  const externalRequests = [];
  const messages = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
      externalRequests.push(url.href);
    }
  });
  page.on("console", (message) => messages.push(message.text()));
  await page.goto("/");
  await page.evaluate(() => {
    const iframe = document.createElement("iframe");
    iframe.id = "surfer-frame";
    iframe.src = "/surfer/index.html";
    document.body.replaceChildren(iframe);
  });
  await expect.poll(() => page.frames().some((frame) => frame.url().endsWith("/surfer/index.html"))).toBe(true);
  const frame = page.frames().find((candidate) => candidate.url().endsWith("/surfer/index.html"));
  assert.ok(frame);
  await frame.waitForFunction(() => typeof window.register_message_listener === "function");
  await page.evaluate((contents) => {
    const iframe = document.querySelector("#surfer-frame");
    const url = URL.createObjectURL(new Blob([contents], { type: "text/plain" }));
    iframe.contentWindow.postMessage({ command: "LoadUrl", url }, window.location.origin);
  }, vcd);
  return { frame, messages, externalRequests };
}

test("loads a VCD from a same-origin blob URL and exposes the logic scope", async ({ page }) => {
  const { frame, messages, externalRequests } = await openSurfer(page, fixture);
  await expect.poll(() => messages.some((message) => message.includes("LoadWaveformFileFromUrl"))).toBe(true);
  await expect.poll(async () => {
    const bodyText = await frame.locator("body").innerText().catch(() => "");
    return bodyText.includes("logic") || messages.some((message) => message.includes("logic"));
  }).toBe(true);
  expect(externalRequests).toEqual([]);
});

test("reports a parse error for a corrupt VCD", async ({ page }) => {
  const { frame, messages, externalRequests } = await openSurfer(page, "not a VCD waveform");
  await expect.poll(async () => {
    const errorText = await frame.locator("#error_message").innerText().catch(() => "");
    return /parse|vcd|error|invalid/i.test(errorText)
      || messages.some((message) => /parse|vcd.*error|error.*vcd/i.test(message));
  }).toBe(true);
  expect(externalRequests).toEqual([]);
});

test("ships Surfer without Service Worker registration", async () => {
  const dist = resolve(root, "dist/surfer");
  const html = readFileSync(resolve(dist, "index.html"), "utf8");
  expect(html).not.toMatch(/navigator\.serviceWorker\.register/);
  expect(existsSync(resolve(dist, "manifest.json"))).toBe(false);
  expect(existsSync(resolve(dist, "sw.js"))).toBe(false);
});
