import { request } from "@playwright/test";
import fs from "fs";
import path from "path";

const BASE = "http://127.0.0.1:8000";

function required(name: string): string {
  const value = process.env[name] || "";
  if (!value) throw new Error(`${name} is required by the hermetic E2E harness`);
  return value;
}

export default async function globalSetup() {
  const password = required("GOLF_E2E_ADMIN_PASSWORD");
  const statePath = required("GOLF_E2E_AUTH_STATE");
  const ctx = await request.newContext();

  try {
    // A brand-new local database seeds admin/admin with a forced password
    // change. Bootstrap it once, then reuse the authenticated storage state so
    // the suite itself does not trip the five-attempt login rate limiter.
    const login = await ctx.post(`${BASE}/auth/login`, {
      data: { username: "admin", password: "admin" },
    });
    if (!login.ok()) {
      throw new Error(`E2E bootstrap login failed with HTTP ${login.status()}`);
    }

    const before = await ctx.storageState();
    const csrf = before.cookies.find((cookie) => cookie.name === "golf_csrf")?.value;
    if (!csrf) throw new Error("E2E bootstrap did not receive golf_csrf cookie");

    const changed = await ctx.post(`${BASE}/me/change-password`, {
      headers: { "X-CSRF-Token": csrf },
      data: { current_password: "admin", new_password: password },
    });
    if (!changed.ok()) {
      throw new Error(`E2E bootstrap password change failed with HTTP ${changed.status()}`);
    }

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    await ctx.storageState({ path: statePath });
  } finally {
    await ctx.dispose();
  }
}
