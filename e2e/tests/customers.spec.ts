import { test, expect } from "@playwright/test";
import { authenticate } from "./fixtures";

test("create new customer and find by search", async ({ page }) => {
  await authenticate(page);
  await page.getByRole("link", { name: "Клиенты" }).click();
  await expect(page.getByTestId("customers-page")).toBeVisible();

  await page.getByTestId("new-customer-btn").click();
  const unique = `E2E Иван ${Date.now()}`;
  await page.getByTestId("input-name").fill(unique);
  await page.getByTestId("input-phone").fill("+7 (999) 000-00-00");
  await page.getByTestId("input-email").fill("e2e@example.com");
  await page.getByTestId("submit-customer").click();

  await expect(page.getByTestId("new-customer-modal")).not.toBeVisible();
  await page.getByTestId("customer-search").fill(unique);
  await expect(page.getByTestId("customer-list")).toContainText(unique);
});

test("services editor lists and allows toggle", async ({ page }) => {
  await authenticate(page);
  await page.getByRole("link", { name: "Услуги", exact: true }).click();
  await expect(page.getByTestId("service-editor-page")).toBeVisible();
  await expect(page.locator('[data-testid^="service-row-"]').first()).toBeVisible();
});

test("instructor editor lists and allows creation", async ({ page }) => {
  await authenticate(page);
  await page.getByRole("link", { name: "Тренеры" }).click();
  await expect(page.getByTestId("instructor-editor-page")).toBeVisible();
  await expect(page.locator('[data-testid^="instr-card-"]').first()).toBeVisible();
});
