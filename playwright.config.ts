import { defineConfig, devices } from "@playwright/test";

// Browser tests: a real browser against the built panel and the mock API.
//
//   npm run test:e2e
//
// Both servers are started when they are not running yet. The tests change
// the state of the mock (they close cargos, record payments) and put the
// demo data back before each test, so they run one at a time.

export default defineConfig({
  testDir: "./e2e",
  // Its own folder: Playwright empties it before a run, and
  // test-results/shots holds the pictures of scripts/shoot.mjs.
  outputDir: "./test-results/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3002",
    locale: "en-GB",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
      testIgnore: /phone\.spec\.ts/,
    },
    {
      name: "phone",
      use: { ...devices["Pixel 7"] },
      testMatch: /phone\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: "npm run dev:mock",
      url: "http://localhost:3000/health/live",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { MOCK_DELAY_MS: "0" },
    },
    {
      command: "npm run build && npm run start",
      url: "http://localhost:3002/sign-in",
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
