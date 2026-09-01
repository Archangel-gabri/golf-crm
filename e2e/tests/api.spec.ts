/**
 * Direct API tests — no UI, verifying FastAPI endpoints work and RBAC/auth hold.
 */
import { test, expect, APIRequestContext } from "@playwright/test";
import { authenticatedApi, csrfHeaders } from "./fixtures";

const BASE = "http://127.0.0.1:8000";

async function login(req: APIRequestContext, username = "admin", password = process.env.GOLF_E2E_ADMIN_PASSWORD || "") {
  const r = await req.post(`${BASE}/auth/login`, { data: { username, password } });
  expect(r.ok()).toBeTruthy();
  return r;
}

test("unauth request to /auth/me is 401", async ({ request }) => {
  const r = await request.get(`${BASE}/auth/me`);
  expect(r.status()).toBe(401);
});

test("login + me returns user", async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  await login(ctx);
  const r = await ctx.get(`${BASE}/auth/me`);
  expect(r.ok()).toBeTruthy();
  const user = await r.json();
  expect(user.username).toBe("admin");
  expect(user.role).toBe("admin");
  await ctx.dispose();
});

test("list resources returns array", async ({ playwright }) => {
  const ctx = await authenticatedApi(playwright);
  const r = await ctx.get(`${BASE}/resources`);
  expect(r.ok()).toBeTruthy();
  const data = await r.json();
  expect(Array.isArray(data)).toBe(true);
  expect(data.length).toBeGreaterThan(0);
  await ctx.dispose();
});

test("create booking and detect conflict on overlap", async ({ playwright }) => {
  const ctx = await authenticatedApi(playwright);

  const resources = await (await ctx.get(`${BASE}/resources/visible`)).json();
  const services = await (await ctx.get(`${BASE}/catalog/services`)).json();
  expect(resources.length).toBeGreaterThan(0);
  expect(services.length).toBeGreaterThan(0);

  // Use a far-future date that's unique per run (derived from epoch seconds)
  // so repeated CI runs never collide with each other's leftovers.
  const epochSec = Math.floor(Date.now() / 1000);
  const daysOut = 90 + (epochSec % 180);          // 90..269 days ahead
  const starts = new Date(Date.now() + daysOut * 86400 * 1000);
  starts.setHours(6, epochSec % 60, 0, 0);
  const ends = new Date(starts.getTime() + 30 * 60 * 1000);

  const fmt = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
  };

  const body = {
    resource_id: resources[0].id,
    service_id: services[0].id,
    starts_at: fmt(starts),
    ends_at: fmt(ends),
    guests: 1,
  };

  const headers = await csrfHeaders(ctx);
  const r1 = await ctx.post(`${BASE}/bookings`, { data: body, headers });
  expect(r1.ok()).toBeTruthy();
  const b1 = await r1.json();
  expect(b1.id).toBeGreaterThan(0);

  // Overlapping booking on same resource should 409
  const r2 = await ctx.post(`${BASE}/bookings`, { data: body, headers });
  expect(r2.status()).toBe(409);

  await ctx.dispose();
});
