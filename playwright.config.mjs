import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 150_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:8000",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "scripts/build-web.sh && python3 dist/serve.py --port 8000",
    url: "http://127.0.0.1:8000",
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 30_000,
  },
});
