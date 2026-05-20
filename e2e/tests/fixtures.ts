import { test as base, expect, Page } from "@playwright/test";

export async function login(page: Page, username = "admin", password = "admin") {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("dashboard-page")).toBeVisible();
}

export const test = base.extend<{ loggedIn: void }>({
  loggedIn: [
    async ({ page }, use) => {
      await login(page);
      await use();
    },
    { auto: false },
  ],
});

export { expect };
