import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/tmp/chrome-linux64/chrome",
  "/tmp/chrome-test/chrome-linux64/chrome",
  "/tmp/mix04-browser/chrome-linux64/chrome",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const executablePath = chromeCandidates.find((candidate) => existsSync(candidate));

export default defineConfig({
  testDir: "./tests",
  timeout: 75_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5190",
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: {
      args: ["--no-sandbox"],
      ...(executablePath ? { executablePath } : {}),
    },
  },
  webServer: {
    command: "node server.mjs",
    url: "http://127.0.0.1:5190",
    reuseExistingServer: false,
    timeout: 15_000,
    env: { PORT: "5190" },
  },
});
