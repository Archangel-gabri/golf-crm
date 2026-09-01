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
const DEFAULT_PYTHON = process.platform === "win32"
  ? path.join(BACKEND_DIR, "venv/Scripts/python.exe")
  : path.join(BACKEND_DIR, "venv/bin/python");

// E2E mutates its database heavily. Refuse to start unless the hermetic test
// runner supplied an isolated /tmp database and a temporary source checkout.
// This prevents an innocent `npx playwright test` from touching golf.db or a
// project .env in the real working tree.
if (process.env.GOLF_E2E_ISOLATED !== "1") {
  throw new Error("Run E2E via: bash scripts/test.sh (isolated temp harness required)");
}

const DATABASE_URL = process.env.GOLF_E2E_DATABASE_URL || "";
const DATABASE_PREFIX = "sqlite:///";
const databasePath = DATABASE_URL.startsWith(DATABASE_PREFIX)
  ? path.resolve(DATABASE_URL.slice(DATABASE_PREFIX.length))
  : "";
const databaseRoot = databasePath ? path.dirname(databasePath) : "";
const sourceRoot = path.resolve(ROOT);
if (
  path.dirname(databaseRoot) !== "/tmp" ||
  !path.basename(databaseRoot).startsWith("golf-test-") ||
  path.basename(databasePath) !== "e2e.sqlite" ||
  sourceRoot !== databaseRoot
) {
  throw new Error("E2E source and database must share the same /tmp/golf-test-* root");
}

const SECRET_KEY = process.env.GOLF_E2E_SECRET_KEY || "";
const ADMIN_PASSWORD = process.env.GOLF_E2E_ADMIN_PASSWORD || "";
const AUTH_STATE = process.env.GOLF_E2E_AUTH_STATE || "";
if (
  SECRET_KEY.length < 32 ||
  ADMIN_PASSWORD.length < 12 ||
  !AUTH_STATE ||
  !path.resolve(AUTH_STATE).startsWith(databaseRoot + path.sep)
) {
  throw new Error("Hermetic E2E credentials/state were not supplied by scripts/test.sh");
}

const PYTHON = process.env.GOLF_E2E_PYTHON || DEFAULT_PYTHON;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./global-setup.ts",
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
      command: `"${PYTHON}" -m uvicorn app.main:app --host 127.0.0.1 --port 8000`,
      cwd: BACKEND_DIR,
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: false,
      timeout: 45_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ENV: "local",
        SECRET_KEY,
        DATABASE_URL,
        CORS_ORIGINS: "http://127.0.0.1:5173",
        CLUB_NAME: "МГГК Synthetic E2E",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
    {
      command: "npm run dev",
      cwd: FRONTEND_DIR,
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 45_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
