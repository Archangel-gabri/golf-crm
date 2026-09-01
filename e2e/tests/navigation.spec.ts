import { test, expect } from "@playwright/test";
import { authenticate, csrfHeaders } from "./fixtures";

test("command palette booking result opens the bookings page", async ({ page }) => {
  await authenticate(page);

  // Seed enough synthetic rows for a two-digit booking id: the search API has
  // a deliberate min_length=2 contract.
  const seeded = await page.request.post("http://127.0.0.1:8000/demo/seed?bookings_count=12", {
    headers: await csrfHeaders(page.request),
  });
  expect(seeded.ok()).toBeTruthy();

  await page.keyboard.press("Control+K");
  await page.getByTestId("cmdk-input").fill("10");
  await expect(page.getByText("Бронь #10", { exact: true })).toBeVisible();
  await page.getByText("Бронь #10", { exact: true }).click();

  await expect(page).toHaveURL(/\/bookings$/);
  await expect(page.getByTestId("bookings-page")).toBeVisible();
});
