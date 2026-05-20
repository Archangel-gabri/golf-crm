import { defineConfig, devices } from "@playwright/test";
import path from "path";

// Vite can't handle "#" in paths (treats it as URL fragment). On Windows we
// expose the project under drive Z: via `subst Z: <real-path>` so paths never
// contain "#". The run.bat in repo root creates the mapping automatically.
const fs = require("fs");
const SUBST_ROOT = "Z:/";
const ROOT = process.platform === "win32" && fs.existsSync(SUBST_ROOT + "frontend/package.json")
  ? SUBST_ROOT
  : path.resolve(__dirname, "..") + "/";
const BACKEND_DIR = path.join(ROOT, "backend");
const FRONTEND_DIR = path.join(ROOT, "frontend");
const PYTHON = process.platform === "win32"
  ? path.join(BACKEND_DIR, "venv/Scripts/python.exe")
  : path.join(BACKEND_DIR, "venv/bin/python");

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: `"${PYTHON}" run.py`,
      cwd: BACKEND_DIR,
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 45_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run dev",
      cwd: FRONTEND_DIR,
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 45_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
