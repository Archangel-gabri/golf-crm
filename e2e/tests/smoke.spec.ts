import { test, expect } from "@playwright/test";

test("backend /health answers", async ({ request }) => {
  const r = await request.get("http://127.0.0.1:8000/health");
  expect(r.ok()).toBeTruthy();
  const body = await r.json();
  expect(body.ok).toBe(true);
  expect(body.club).toContain("МГГК");
});

test("frontend login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-form")).toBeVisible();
  // Never prefill a privileged username on the real login form.
  await expect(page.getByTestId("username")).toHaveValue("");
});
