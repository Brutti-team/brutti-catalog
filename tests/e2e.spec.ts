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

test("an expired recovery link cannot submit a password or open the workspace", async ({ page }) => {
  let updates = 0;
  await page.route(api, async route => {
    if (route.request().method() === "PUT") updates++;
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Link expired" }) });
  });
  await page.goto("/?auth=recovery");
  await expect(page.getByRole("heading", { name: "Reset your password." })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("expired or invalid");
  await expect(page.getByRole("button", { name: "Save password" })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  expect(updates).toBe(0);
});

test("reset email uses the same access card and does not disclose account existence", async ({ page }) => {
  let redirect = "";
  await page.route("**/auth/v1/recover**", async route => {
    redirect = route.request().url();
    expect(route.request().postDataJSON().email).toBe("admin@example.test");
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/#/admin");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("status")).toContainText("If this account exists");
  expect(decodeURIComponent(redirect)).toContain("auth=recovery");
  await expect(page.locator(".access-card")).toBeVisible();
});

test("invite callback sets a verified user's password without granting admin membership", async ({ page }) => {
  const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "invited@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-10-13T00:00:00Z" };
  let updates = 0;
  await page.route(api, async route => {
    const url = route.request().url();
    if (url.includes("/auth/v1/user")) {
      if (route.request().method() === "PUT") {
        updates++;
        expect(route.request().postDataJSON()).toEqual({ password: "new-invite-password", code_challenge: null, code_challenge_method: null });
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: url.includes("catalog_admins") ? "null" : "[]" });
    }
  });
  await page.goto("/#access_token=mock-browser-token&refresh_token=mock-refresh-token&expires_in=3600&token_type=bearer&type=invite");
  await expect(page.getByRole("heading", { name: "Set your password." })).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill("new-invite-password");
  await page.getByLabel("Confirm password", { exact: true }).fill("different-password");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("alert")).toContainText("Passwords do not match");
  expect(updates).toBe(0);
  await page.getByLabel("Confirm password", { exact: true }).fill("new-invite-password");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Admin access required" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add product" })).toHaveCount(0);
  expect(updates).toBe(1);
});

for (const callback of ["?auth=recovery#error=access_denied&error_code=otp_expired&type=recovery", "?auth=recovery"]) {
  test(`cached login cannot authorize password completion at ${callback}`, async ({ page }) => {
    const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "cached@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-10-13T00:00:00Z" };
    let updates = 0;
    await page.addInitScript(({ user }) => {
      localStorage.setItem("sb-catalog-browser-test-auth-token", JSON.stringify({
        access_token: "cached-valid-token", refresh_token: "cached-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user,
      }));
    }, { user });
    await page.route(api, async route => {
      if (route.request().method() === "PUT") updates++;
      const url = route.request().url();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(url.includes("/auth/v1/user") ? user : url.includes("catalog_admins") ? null : []) });
    });
    await page.goto(`/${callback}`);
    await expect(page.getByRole("heading", { name: "Reset your password." })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("expired or invalid");
    await expect(page.getByRole("button", { name: "Save password" })).toHaveCount(0);
    expect(updates).toBe(0);
  });
}
