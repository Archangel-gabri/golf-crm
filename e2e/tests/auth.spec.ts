import { test, expect } from "@playwright/test";
import { authenticate, loginViaUi } from "./fixtures";

test("login with valid credentials lands on dashboard", async ({ page }) => {
  await loginViaUi(page);
  await expect(page.getByTestId("dashboard-page")).toBeVisible();
  await expect(page.getByTestId("current-user")).toContainText(/Админ/i);
});

test("login with wrong password shows error", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("username").fill("admin");
  await page.getByTestId("password").fill("not-the-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("logout clears session", async ({ page }) => {
  await authenticate(page);
  await page.getByTestId("logout-btn").click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("unauthenticated visit redirects to /login", async ({ page }) => {
  await page.goto("/tee-sheet");
  await expect(page).toHaveURL(/\/login$/);
});
