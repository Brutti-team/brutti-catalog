import { test, expect } from "@playwright/test";

const api = "https://catalog-browser-test.supabase.co/**";

test.beforeEach(async ({ page }) => {
  // Browser tests use intercepted API calls, not a live Supabase project.
  await page.route(api, async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/token")) {
      await route.fulfill({
        status: 400, contentType: "application/json",
        body: JSON.stringify({
          code: "invalid_credentials", message: "Invalid login credentials",
        }),
      });
      return;
    }
    if (url.includes("/auth/v1/user")) {
      await route.fulfill({
        status: 401, contentType: "application/json",
        body: JSON.stringify({ code: "auth_session_missing", message: "Auth session missing" }),
      });
      return;
    }
    await route.fulfill({
      status: 200, contentType: "application/json", body: "[]",
    });
  });
});

test("catalog admin requires actual authentication and never shows unsecured demo", async ({ page }) => {
  await page.goto("/#/admin");
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByText("Demo mode", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset demo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add product" })).toHaveCount(0);
});

test("invalid credentials never grant administrator access", async ({ page }) => {
  await page.goto("/#/admin");
  await page.getByLabel("Email", { exact: true }).fill("unauthorized@example.test");
  await page.getByLabel("Password", { exact: true }).fill("invalid-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid login credentials");
  await expect(page.getByRole("heading", { name: "A home for every piece." })).toHaveCount(0);
});

test("catalog public page never fabricates sample products", async ({ page }) => {
  await page.goto("/#/catalog");
  await expect(page.getByRole("heading", { name: "Good design. Better living." })).toBeVisible();
  await expect(page.locator(".pub-products-grid .pub-product-card")).toHaveCount(0);
  await expect(page.getByText("Demo catalog", { exact: false })).toHaveCount(0);
});

test("mobile catalog preserves its design and does not overflow horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/catalog");
  await expect(page.getByRole("heading", { name: "Good design. Better living." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
