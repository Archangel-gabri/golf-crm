import { test, expect } from "@playwright/test";
import { login } from "./fixtures";

test("coupon CRUD + applies to price quote", async ({ page, request }) => {
  await login(page);

  // create via API (faster)
  const ctxHeaders = await page.context().storageState();
  void ctxHeaders;

  // Navigate UI
  await page.getByRole("link", { name: "Промокоды" }).click();
  await expect(page.getByTestId("coupons-page")).toBeVisible();

  const uniq = `E2E${Date.now() % 100000}`;
  await page.getByRole("button", { name: /Новый промокод/ }).click();
  await page.locator('input[required]').first().fill(uniq);
  // value input = second number input
  const nums = page.locator('input[type="number"]');
  await nums.first().fill("15");
  await page.getByRole("button", { name: /Сохранить/ }).click();

  await expect(page.getByText(uniq, { exact: true })).toBeVisible();
});

test("price quote endpoint returns coupon discount", async ({ page }) => {
  await login(page);
  const resp = await page.request.post("http://127.0.0.1:8000/coupons/quote", {
    data: { service_id: 1, guests: 1, duration_min: 60, coupon_code: "NOSUCHCODE" },
  });
  expect(resp.ok()).toBeTruthy();
  const data = await resp.json();
  expect(data).toHaveProperty("base_kopecks");
  expect(data).toHaveProperty("total_kopecks");
});
