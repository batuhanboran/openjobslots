const { defineConfig, devices } = require("@playwright/test");

const webPort = process.env.OPENJOBSLOTS_E2E_WEB_PORT || "19006";
const baseURL = process.env.OPENJOBSLOTS_E2E_BASE_URL || `http://127.0.0.1:${webPort}`;

module.exports = defineConfig({
  testDir: ".",
  testMatch: ["tests/api/**/*.test.js", "tests/e2e/**/*.spec.js"],
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  outputDir: "test-results/e2e",
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "node scripts/test/e2e-stack.js",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
    },
    {
      name: "chromium-mobile",
      testMatch: ["tests/e2e/**/*.spec.js"],
      use: { ...devices["Pixel 7"] }
    }
  ]
});
