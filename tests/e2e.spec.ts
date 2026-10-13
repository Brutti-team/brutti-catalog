import { test, expect, type Page } from "@playwright/test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBZwAAAAASUVORK5CYII=",
  "base64",
);

async function openAdmin(page: Page) {
  await page.goto("/#/admin");
  await expect(
    page.getByRole("heading", { name: "A home for every piece." }),
  ).toBeVisible();
  await expect(
    page.getByText("This workspace has no secure authentication.", {
      exact: false,
    }),
  ).toBeVisible();
}

async function addCategory(page: Page, name: string) {
  await page.getByRole("button", { name: "Categories", exact: true }).click();
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add category" });
  await dialog.getByLabel("Category name").fill(name);
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Thoughtfully crafted pieces for flexible spaces.");
  await dialog.getByRole("button", { name: "Save category" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("demo dashboard describes its access honestly and shows seeded collection statistics", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await openAdmin(page);
  for (const [label, count] of [
    ["Total products", "8"],
    ["Published", "6"],
    ["Drafts", "1"],
    ["Categories", "7"],
  ]) {
    await expect(
      page.locator(".stat-card").filter({ hasText: label }).locator("strong"),
    ).toHaveText(count);
  }
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(6);
  await page.screenshot({
    path: "test-results/screenshots/admin-desktop.png",
    fullPage: true,
  });
  expect(browserErrors).toEqual([]);
});

test("a draft product persists all fields and uploads, then publication and archival control public visibility", async ({
  page,
}) => {
  await openAdmin(page);
  await addCategory(page, "Objects");
  await page.getByRole("button", { name: /^Products/ }).click();
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Create product" });
  await editor.getByLabel("Product name").fill("Sela Test Bench");
  await editor.getByLabel("SKU").fill("BR-TEST-001");
  await editor
    .getByLabel("Category", { exact: false })
    .selectOption({ label: "Objects" });
  await editor
    .getByLabel("Description", { exact: true })
    .fill(
      "A solid timber bench with quiet proportions and a hand-finished surface.",
    );
  await editor
    .getByLabel("Materials", { exact: true })
    .fill("Solid oak, natural oil");
  await editor.getByLabel("width in centimetres").fill("120");
  await editor.getByLabel("depth in centimetres").fill("40");
  await editor.getByLabel("height in centimetres").fill("45");
  await editor
    .getByRole("combobox", { name: "Availability", exact: true })
    .selectOption("made-to-order");
  await editor.getByLabel("Feature this product", { exact: false }).check();
  await editor.locator("input[type=file]").setInputFiles([
    { name: "bench-cover.png", mimeType: "image/png", buffer: tinyPng },
    { name: "bench-detail.png", mimeType: "image/png", buffer: tinyPng },
  ]);
  await expect(editor.getByLabel("Image 1 description")).toHaveValue(
    "bench cover",
  );
  await expect(editor.getByLabel("Image 2 description")).toHaveValue(
    "bench detail",
  );
  await editor
    .getByLabel("Image 1 description")
    .fill("The Sela bench, front view");
  await editor
    .getByLabel("Image 2 description")
    .fill("The Sela bench, timber detail");
  await editor.getByRole("button", { name: "Move image 2 earlier" }).click();
  await expect(editor.getByLabel("Image 1 description")).toHaveValue(
    "The Sela bench, timber detail",
  );
  await expect(
    editor.getByRole("button", { name: "Move image 1 earlier" }),
  ).toBeDisabled();
  await editor.getByRole("button", { name: "Move image 1 later" }).click();
  await expect(editor.getByLabel("Image 1 description")).toHaveValue(
    "The Sela bench, front view",
  );
  await editor.getByRole("button", { name: "Preview product" }).click();
  await expect(editor.locator(".editor-preview")).toContainText(
    "Sela Test Bench",
  );
  await expect(editor.locator(".editor-preview")).toContainText(
    "Price on enquiry",
  );
  await expect(editor.locator(".editor-preview img")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  await page.screenshot({
    path: "test-results/screenshots/product-editor-desktop.png",
    fullPage: true,
  });
  await editor.getByRole("button", { name: "Save product" }).click();
  await expect(editor).not.toBeVisible();
  await page.getByLabel("Search products").fill("BR-TEST-001");
  const row = page.getByRole("row").filter({ hasText: "Sela Test Bench" });
  await expect(row).toContainText("Draft");
  await expect(row).toContainText("Made To Order");
  await expect(row).toContainText("On enquiry");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A home for every piece." }),
  ).toBeVisible();
  await page.getByLabel("Search products").fill("BR-TEST-001");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Edit Sela Test Bench" }).click();
  const edit = page.getByRole("dialog", { name: "Edit product" });
  await expect(edit.getByLabel("Materials", { exact: true })).toHaveValue(
    "Solid oak, natural oil",
  );
  await expect(edit.getByLabel("width in centimetres")).toHaveValue("120");
  await expect(edit.getByLabel("Image 2 description")).toHaveValue(
    "The Sela bench, timber detail",
  );
  await edit
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("published");
  await edit.getByRole("button", { name: "Save product" }).click();
  await expect(edit).not.toBeVisible();
  await page.goto("/#/catalog");
  const productLink = page.getByRole("link", { name: /Sela Test Bench/ });
  await expect(productLink).toBeVisible();
  await productLink.click();
  await expect(
    page.getByRole("heading", { name: "Sela Test Bench", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".pub-specifications")).toContainText(
    "120 W × 40 D × 45 H cm",
  );
  await expect(page.locator(".pub-specifications")).toContainText(
    "Solid oak, natural oil",
  );
  await page
    .getByRole("button", {
      name: "View image 2: The Sela bench, timber detail",
    })
    .click();
  await expect(page.locator(".pub-detail-main-image img")).toHaveAttribute(
    "alt",
    "The Sela bench, timber detail",
  );
  await expect(
    page.getByRole("button", {
      name: "View image 2: The Sela bench, timber detail",
    }),
  ).toHaveAttribute("aria-pressed", "true");
  const productDetailUrl = page.url();
  await page.goto("/#/admin");
  await page.getByLabel("Search products").fill("BR-TEST-001");
  await row.getByRole("button", { name: "Edit Sela Test Bench" }).click();
  await edit
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("archived");
  await edit.getByRole("button", { name: "Save product" }).click();
  await expect(edit).not.toBeVisible();
  await page.goto("/#/catalog");
  await expect(page.getByRole("link", { name: /Sela Test Bench/ })).toHaveCount(
    0,
  );
  await page.goto(productDetailUrl);
  await expect(
    page.getByRole("heading", { name: "This piece isn’t in the collection." }),
  ).toBeVisible();
});

test("category editing and safe deletion work without orphaning products", async ({
  page,
}) => {
  await openAdmin(page);
  await addCategory(page, "Lighting");
  let category = page.locator(".category-card").filter({
    has: page.getByRole("heading", { name: "Lighting", exact: true }),
  });
  await category.getByRole("button", { name: "Edit category" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit category" });
  await dialog.getByLabel("Category name").fill("Ambient lighting");
  await dialog.getByRole("button", { name: "Save category" }).click();
  await expect(dialog).not.toBeVisible();
  category = page.locator(".category-card").filter({
    has: page.getByRole("heading", { name: "Ambient lighting", exact: true }),
  });
  await expect(category).toContainText("0 pieces");
  await expect(
    page.getByRole("button", { name: "Delete Seating", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (confirmation) => confirmation.accept());
  await category
    .getByRole("button", { name: "Delete Ambient lighting", exact: true })
    .click();
  await expect(category).toHaveCount(0);
});

test("product editor handles invalid uploads and supports keyboard dismissal and focus containment", async ({
  page,
}) => {
  await openAdmin(page);
  const addProduct = page.getByRole("button", {
    name: "Add product",
    exact: true,
  });
  await addProduct.click();
  const editor = page.getByRole("dialog", { name: "Create product" });
  await expect(editor).toBeVisible();
  expect(await editor.evaluate((dialog) => dialog.matches(":modal"))).toBe(
    true,
  );
  for (let index = 0; index < 32; index++) {
    await page.keyboard.press("Tab");
    // Native dialogs allow focus into browser chrome at the end of the cycle;
    // the page body is then active, while background application controls stay inert.
    expect(
      await editor.evaluate(
        (dialog) =>
          document.activeElement === document.body ||
          dialog.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await editor.locator("input[type=file]").setInputFiles({
    name: "invalid.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg></svg>"),
  });
  await expect(editor.getByRole("alert")).toContainText(/JPEG.*PNG.*WebP/i);
  await expect(editor.locator(".image-editor-item")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editor).not.toBeVisible();
  await expect(addProduct).toBeFocused();
});

test("public collection supports search, category and featured filters, details and clear enquiry availability", async ({
  page,
}) => {
  await page.goto("/#/catalog");
  await expect(
    page.getByRole("heading", { name: "Good design. Better living." }),
  ).toBeVisible();
  await expect(
    page.getByText("Demo catalog", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.locator(".pub-products-grid .pub-product-card"),
  ).toHaveCount(6);
  await page.getByRole("button", { name: "Seating", exact: true }).click();
  await expect(
    page.locator(".pub-products-grid .pub-product-card"),
  ).toHaveCount(3);
  await page
    .getByRole("button", { name: "Featured only", exact: true })
    .click();
  await expect(
    page.locator(".pub-products-grid .pub-product-card"),
  ).toHaveCount(2);
  await expect(page.getByRole("link", { name: /Nala Bar Stool/ })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.getByLabel("Search the catalog").fill("BR-TAB-002");
  await expect(
    page.locator(".pub-products-grid .pub-product-card"),
  ).toHaveCount(1);
  await page.getByRole("link", { name: /Bulat Coffee Table/ }).click();
  await expect(
    page.getByRole("heading", { name: "Bulat Coffee Table", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".pub-detail-price")).toHaveText(
    "Price on enquiry",
  );
  await expect(page.locator(".pub-specifications")).toContainText(
    "80 W × 80 D × 38 H cm",
  );
  await expect(
    page.getByRole("button", { name: "Enquiries coming soon", exact: false }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Enquire about this piece", exact: false }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Back to the collection", exact: true })
    .click();
  await page.getByLabel("Search the catalog").fill("no-such-piece");
  await expect(
    page.getByRole("heading", { name: "No pieces found." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View all furniture", exact: true })
    .click();
  await expect(
    page.locator(".pub-products-grid .pub-product-card"),
  ).toHaveCount(6);
  await page
    .getByRole("button", { name: "Featured pieces", exact: true })
    .click();
  await expect(
    page.locator(".pub-products-grid .pub-product-card"),
  ).toHaveCount(3);
  await page.screenshot({
    path: "test-results/screenshots/catalog-desktop.png",
    fullPage: true,
  });
});

test("mobile admin, collection, and product details fit the viewport and preserve useful navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAdmin(page);
  await assertNoHorizontalOverflow(page);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("button", { name: /^Products/ }).click();
  await expect(
    page.getByRole("heading", { name: "Your collection." }),
  ).toBeVisible();
  await page.getByLabel("Search products").fill("Senar");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: "test-results/screenshots/admin-mobile.png",
    fullPage: true,
  });
  await page.goto("/#/catalog");
  await expect(
    page.getByRole("heading", { name: "Good design. Better living." }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: "test-results/screenshots/catalog-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Featured pieces", exact: true })
    .click();
  await expect(
    page.locator(".pub-products-grid .pub-product-card"),
  ).toHaveCount(3);
  await page.getByRole("link", { name: /Senar Lounge Chair/ }).click();
  await expect(
    page.getByRole("heading", { name: "Senar Lounge Chair", exact: true }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: "test-results/screenshots/product-mobile.png",
    fullPage: true,
  });
});

test("saved demo data errors are visible and the reset action restores a usable collection", async ({
  page,
}) => {
  await openAdmin(page);
  await page.evaluate(() =>
    localStorage.setItem("brutti-catalog.demo.v1", "{broken"),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Saved demo data could not be read",
  );
  page.once("dialog", (confirmation) => confirmation.accept());
  await page
    .getByRole("button", { name: "Reset demo data", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "Total products" })
      .locator("strong"),
  ).toHaveText("8");
  await expect(page.locator("tbody tr")).toHaveCount(6);
});

test("configured authentication displays a rejected Supabase sign-in and keeps admin access closed", async ({
  page,
}) => {
  // These intercepted requests exercise the configured UI without real credentials.
  // Authentication, database policies and storage still need validation in a real project.
  await page.route(
    "https://catalog-browser-test.supabase.co/**",
    async (route) => {
      if (route.request().url().includes("/auth/v1/token")) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            code: "invalid_credentials",
            message: "Invalid login credentials",
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        });
      }
    },
  );
  await page.goto("http://127.0.0.1:5191/#/admin");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(
    page.getByText("This workspace has no secure authentication.", {
      exact: false,
    }),
  ).toHaveCount(0);
  await page
    .getByLabel("Email", { exact: true })
    .fill("catalog-admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("invalid-browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid login credentials",
  );
  await expect(
    page.getByRole("heading", { name: "A home for every piece." }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Explore the public catalog", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "No pieces found." }),
  ).toBeVisible();
  await expect(
    page.locator(".pub-products-grid .pub-product-card"),
  ).toHaveCount(0);
  await expect(page.getByText("Demo catalog", { exact: false })).toHaveCount(0);
});
