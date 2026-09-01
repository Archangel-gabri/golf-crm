import fs from "fs";
import { test as base, expect, APIRequestContext, Page, Playwright } from "@playwright/test";

function required(name: string): string {
  const value = process.env[name] || "";
  if (!value) throw new Error(`${name} is required by the hermetic E2E harness`);
  return value;
}

export async function loginViaUi(page: Page, username = "admin", password = required("GOLF_E2E_ADMIN_PASSWORD")) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("dashboard-page")).toBeVisible();
}

export async function authenticate(page: Page) {
  const state = JSON.parse(fs.readFileSync(required("GOLF_E2E_AUTH_STATE"), "utf8"));
  await page.context().addCookies(state.cookies);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("dashboard-page")).toBeVisible();
}

export async function authenticatedApi(playwright: Playwright): Promise<APIRequestContext> {
  return playwright.request.newContext({ storageState: required("GOLF_E2E_AUTH_STATE") });
}

export async function csrfHeaders(req: APIRequestContext): Promise<Record<string, string>> {
  const state = await req.storageState();
  const csrf = state.cookies.find((cookie) => cookie.name === "golf_csrf")?.value;
  expect(csrf, "authenticated request context must contain golf_csrf").toBeTruthy();
  return { "X-CSRF-Token": csrf! };
}

export const test = base.extend<{ loggedIn: void }>({
  loggedIn: [
    async ({ page }, use) => {
      await authenticate(page);
      await use();
    },
    { auto: false },
  ],
});

export { expect };
