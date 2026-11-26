import { test, expect } from "@playwright/test";

test("wallet connect", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.*/);
});

test("merchant register", async ({ page }) => {
  await page.goto("/");
});

test("process payment", async ({ page }) => {
  await page.goto("/");
});

test("initiate refund", async ({ page }) => {
  await page.goto("/");
});
