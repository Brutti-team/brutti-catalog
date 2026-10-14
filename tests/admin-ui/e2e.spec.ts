import { test, expect, type Page, type Locator } from '@playwright/test';
import { bruttiCategories } from '../../src/data/categories';

const endpoint = 'https://catalog-browser-test.supabase.co';
const themeKey = 'brutti-catalog-admin-theme';
const fixtureUser = {
  id: '90000000-0000-4000-8000-000000000101',
  email: 'admin-ui-fixture@example.invalid',
  role: 'authenticated', aud: 'authenticated',
  user_metadata: { full_name: 'Alex Fixture' },
  last_sign_in_at: '2026-10-13T00:00:00.000Z',
};
const token = `e30.${Buffer.from(JSON.stringify({ sub: fixtureUser.id, exp: 4102444800, role: 'authenticated' })).toString('base64url')}.test`;
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const fixtureProduct = {
  id: '90000000-0000-4000-8000-000000000102', name: 'Admin UI fixture shelf', sku: 'TEST-ADMIN-UI-1',
  category_id: bruttiCategories[0].id, description: 'Isolated browser fixture product.', materials: 'Test fixture timber.',
  width: 50, depth: 50, height: 50, price: 320, status: 'published', availability: 'available', featured: false,
  created_at: '2026-10-13T00:00:00.000Z', updated_at: '2026-10-13T00:00:00.000Z',
  images: [{ id: 'admin-ui-fixture-photo', alt: 'Test fixture shelf', url: `${endpoint}/storage/v1/object/public/product-images/tests/admin-ui.png` }],
};
type FixtureOptions = {
  savedTheme?: string;
  blockThemeStorage?: boolean;
  logoutFailure?: boolean;
  role?: 'super_admin' | 'admin' | 'editor';
  displayName?: string;
};

async function backend(page: Page, options: FixtureOptions = {}) {
  let user = { ...fixtureUser, user_metadata: { full_name: options.displayName ?? fixtureUser.user_metadata.full_name } };
  let signedOut = false;
  const profileUpdates: unknown[] = [];
  await page.addInitScript(({ token, user, themeKey, savedTheme, blockThemeStorage }) => {
    localStorage.setItem('sb-catalog-browser-test-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'test-refresh', token_type: 'bearer',
      expires_at: 4102444800, expires_in: 3600, user,
    }));
    if (!sessionStorage.getItem('admin-ui-fixture-initialized')) {
      if (savedTheme !== undefined) localStorage.setItem(themeKey, savedTheme);
      sessionStorage.setItem('admin-ui-fixture-initialized', 'true');
    }
    if (blockThemeStorage) {
      const read = Storage.prototype.getItem;
      const write = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key: string) {
        if (key === themeKey) throw new DOMException('Theme storage blocked by fixture.', 'SecurityError');
        return read.call(this, key);
      };
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === themeKey) throw new DOMException('Theme storage blocked by fixture.', 'SecurityError');
        return write.call(this, key, value);
      };
    }
  }, { token, user, themeKey, savedTheme: options.savedTheme, blockThemeStorage: options.blockThemeStorage });
  // Fail closed if a browser configuration ever points at a real Supabase project.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname.endsWith('.supabase.co') && url.origin !== endpoint ? route.abort() : route.continue();
  });
  await page.routeWebSocket('**/realtime/v1/websocket**', () => {});
  await page.route(`${endpoint}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/auth/v1/user') {
      if (request.method() === 'PUT') {
        const update = request.postDataJSON();
        profileUpdates.push(update);
        user = { ...user, user_metadata: { ...user.user_metadata, ...update.data } };
      }
      return json(user);
    }
    if (url.pathname === '/auth/v1/logout') {
      if (options.logoutFailure) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Fixture sign out temporarily unavailable.' }) });
      signedOut = true;
      return json({});
    }
    if (url.pathname.endsWith('/catalog_admins')) return json(signedOut ? null : { user_id: fixtureUser.id });
    if (url.pathname.endsWith('/categories')) return json(bruttiCategories);
    if (url.pathname.endsWith('/products')) return json([fixtureProduct]);
    if (url.pathname.endsWith('/rpc/catalog_capabilities')) return json({ ordering: false, imageCleanup: false, priceBasis: false });
    if (url.pathname.endsWith('/rpc/catalog_my_role')) {
      if (options.role) return json(options.role);
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: 'Test fixture has no role-management RPC.' }) });
    }
    if (url.pathname.endsWith('/rpc/catalog_list_staff') || url.pathname.endsWith('/catalog_activity')) return json([]);
    if (url.pathname.includes('/storage/v1/object/public/')) return route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
    return json({});
  });
  return { user: () => user, profileUpdates: () => profileUpdates, signedOut: () => signedOut };
}

async function openAdmin(page: Page) {
  await page.goto('/#/admin');
  await expect(page.locator('.profile-copy strong')).toHaveText(/.+/);
  await expect(page.locator('.product-cell strong')).toHaveText(fixtureProduct.name);
  await page.evaluate(() => document.fonts.ready);
}

async function expectTheme(page: Page, theme: 'light' | 'dark') {
  await expect(page.locator('.admin-app')).toHaveAttribute('data-theme', theme);
  await expect(page.getByRole('button', { name: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`, exact: true }))
    .toHaveAttribute('aria-pressed', String(theme === 'dark'));
}

// Compose translucent CSS backgrounds with ancestor surfaces before applying WCAG 2.2 contrast.
async function colors(locator: Locator, pseudo?: '::placeholder', property: 'color' | 'outlineColor' = 'color') {
  return locator.evaluate((element, { pseudo, property }) => {
    type Color = [number, number, number, number];
    const parse = (css: string): Color => {
      const values = css.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      return [values[0], values[1], values[2], values[3] ?? 1];
    };
    const blend = (front: Color, back: Color): Color => [
      front[0] * front[3] + back[0] * (1 - front[3]),
      front[1] * front[3] + back[1] * (1 - front[3]),
      front[2] * front[3] + back[2] * (1 - front[3]), 1,
    ];
    const ancestors: Element[] = [];
    for (let parent: Element | null = element; parent; parent = parent.parentElement) ancestors.unshift(parent);
    const background = ancestors.reduce<Color>((back, ancestor) => blend(parse(getComputedStyle(ancestor).backgroundColor), back), [255, 255, 255, 1]);
    const foregroundStyle = getComputedStyle(element, pseudo);
    const textColor = parse(foregroundStyle[property]);
    // Placeholder opacity applies to its glyphs in addition to any rgba alpha.
    if (pseudo) textColor[3] *= Number(foregroundStyle.opacity);
    const foreground = blend(textColor, background);
    const luminance = (color: Color) => color.slice(0, 3).map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const foregroundLuminance = luminance(foreground), backgroundLuminance = luminance(background);
    return { foreground, background, backgroundLuminance,
      contrast: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05) };
  }, { pseudo, property });
}

async function expectReadable(page: Page, selectors: string[], darkSurface = false) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    await expect(locator, selector).toBeVisible();
    const actual = await colors(locator);
    expect(actual.contrast, `${selector}: ${JSON.stringify(actual)}`).toBeGreaterThanOrEqual(4.5);
    if (darkSurface) expect(actual.backgroundLuminance, `${selector} must use a dark surface`).toBeLessThan(0.2);
  }
}

test('header provides my profile and a dark-mode toggle', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await backend(page);
  await page.goto('/#/admin');
  const header = page.locator('.topbar');
  await expect(header.getByRole('button', { name: 'Open my profile', exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Switch to dark mode', exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(header.locator('.profile-copy strong')).toHaveText('Alex Fixture');
  await expect(header.locator('.profile-copy small')).toHaveText('Catalog administrator');
  await expect(header.locator('.profile-avatar')).toHaveText('AF');
  await expect(page.locator('.sidebar .account')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: 'My profile', exact: true })).toBeVisible();
});

test('header profile opens the existing account form and saved Auth metadata updates the header', async ({ page }) => {
  const db = await backend(page, { role: 'admin' });
  await openAdmin(page);
  await expect(page.locator('.profile-copy small')).toHaveText('Admin');
  await page.getByRole('button', { name: 'Open my profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My profile.', exact: true })).toBeVisible();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Alex Fixture');
  await expect(page.getByLabel('Login email', { exact: true })).toHaveAttribute('readonly', '');
  await page.getByLabel('Display name', { exact: true }).fill('  Morgan   Fixture  ');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your profile has been updated.');
  await expect(page.locator('.profile-copy strong')).toHaveText('Morgan Fixture');
  await expect(page.locator('.profile-avatar')).toHaveText('MF');
  await expect(page.locator('.account-identity h2')).toHaveText('Morgan Fixture');
  expect(db.user().user_metadata.full_name).toBe('Morgan Fixture');
  expect(db.profileUpdates()).toEqual([expect.objectContaining({ data: { full_name: 'Morgan Fixture' } })]);
  await page.reload();
  await expect(page.locator('.profile-copy strong')).toHaveText('Morgan Fixture');
});

test('header sign out terminates the intercepted session', async ({ page }) => {
  const db = await backend(page);
  await openAdmin(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  expect(db.signedOut()).toBe(true);
});

test('failed remote header sign out reports its error after leaving My profile', async ({ page }) => {
  const db = await backend(page, { logoutFailure: true, savedTheme: 'dark' });
  await openAdmin(page);
  await page.getByRole('button', { name: 'Open my profile', exact: true }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture sign out temporarily unavailable.');
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sb-catalog-browser-test-auth-token'))).toBeNull();
  expect(db.signedOut()).toBe(false);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`first admin visit respects the ${colorScheme} system preference without saving a choice`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await backend(page);
    await openAdmin(page);
    await expectTheme(page, colorScheme);
    expect(await page.evaluate(key => localStorage.getItem(key), themeKey)).toBeNull();
  });

  test(`saved ${colorScheme} choice overrides the opposite system preference`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: colorScheme === 'dark' ? 'light' : 'dark' });
    await backend(page, { savedTheme: colorScheme });
    await openAdmin(page);
    await expectTheme(page, colorScheme);
    await page.reload();
    await expectTheme(page, colorScheme);
  });

  test(`invalid saved theme falls back to the ${colorScheme} system preference`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await backend(page, { savedTheme: 'invalid-fixture-value' });
    await openAdmin(page);
    await expectTheme(page, colorScheme);
  });
}

test('explicit theme choices persist across reloads', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await backend(page);
  await openAdmin(page);
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expectTheme(page, 'dark');
  expect(await page.evaluate(key => localStorage.getItem(key), themeKey)).toBe('dark');
  await page.reload();
  await expectTheme(page, 'dark');
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await expectTheme(page, 'light');
  await page.reload();
  await expectTheme(page, 'light');
  expect(await page.evaluate(key => localStorage.getItem(key), themeKey)).toBe('light');
});

test('blocked theme storage still allows the admin UI and theme switch', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await backend(page, { blockThemeStorage: true });
  await openAdmin(page);
  await expectTheme(page, 'dark');
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await expectTheme(page, 'light');
  await page.getByRole('button', { name: 'Open my profile', exact: true }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Alex Fixture');
  expect(errors).toEqual([]);
});

test('unavailable management RPC keeps Users and Activity hidden after theme and profile changes', async ({ page }) => {
  await backend(page, { savedTheme: 'light' });
  await openAdmin(page);
  const navigation = page.getByRole('navigation', { name: 'Admin navigation' });
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await page.getByRole('button', { name: 'Open my profile', exact: true }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: 'Users', exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('button', { name: 'Activity log', exact: true })).toHaveCount(0);
  await expect(page.locator('.profile-copy small')).toHaveText('Catalog administrator');
});

for (const role of ['super_admin', 'admin', 'editor'] as const) {
  test(`${role} navigation retains existing management permission gates`, async ({ page }) => {
    await backend(page, { role, savedTheme: 'dark' });
    await openAdmin(page);
    await expect(page.locator('.profile-copy small')).toHaveText(role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Admin' : 'Editor');
    const navigation = page.getByRole('navigation', { name: 'Admin navigation' });
    await expect(navigation.getByRole('button', { name: 'Users', exact: true })).toHaveCount(role === 'super_admin' ? 1 : 0);
    await expect(navigation.getByRole('button', { name: 'Categories', exact: true })).toHaveCount(role === 'editor' ? 0 : 1);
    await expect(navigation.getByRole('button', { name: 'Activity log', exact: true })).toBeVisible();
  });
}

test('dark admin navigation leaves the public catalog light and preserves the saved admin choice', async ({ page }) => {
  await backend(page, { savedTheme: 'dark' });
  await openAdmin(page);
  await expectTheme(page, 'dark');
  await page.locator('.topbar').getByRole('button', { name: 'View catalog', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good design. Better living.', exact: true })).toBeVisible();
  await expect(page.locator('[data-theme]')).toHaveCount(0);
  await expect(page.locator('.admin-app')).toHaveCount(0);
  const publicSurface = await colors(page.locator('.pub-app'));
  expect(publicSurface.backgroundLuminance).toBeGreaterThan(0.7);
  await expect(page.locator('.pub-product-card')).toContainText(fixtureProduct.name);
  await page.goto('/#/admin');
  await expectTheme(page, 'dark');
});

test('dark theme covers table, navigation, product and category forms, and account surfaces with readable text', async ({ page }) => {
  await backend(page, { savedTheme: 'dark' });
  await openAdmin(page);
  await expectReadable(page, ['.profile-copy strong', '.profile-copy small', '.sidebar .nav-item.active', '.sidebar .nav-group-label', '.sidebar-note p', '.product-cell strong', '.product-cell small', 'thead th', '.price-cell', '.status-badge', '.panel-heading p', '.table-footer'], true);
  const searchPlaceholder = await colors(page.getByLabel('Search products', { exact: true }), '::placeholder');
  expect(searchPlaceholder.contrast, `Search placeholder: ${JSON.stringify(searchPlaceholder)}`).toBeGreaterThanOrEqual(4.5);
  for (const selector of ['.theme-toggle svg', '.header-signout svg']) {
    const actual = await colors(page.locator(selector));
    expect(actual.contrast, `${selector}: ${JSON.stringify(actual)}`).toBeGreaterThanOrEqual(3);
  }
  await page.getByRole('button', { name: `Edit ${fixtureProduct.name}`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit product', exact: true })).toBeVisible();
  await expectReadable(page, ['.modal-heading h2', '.editor-form label', '.editor-form input:not([type="checkbox"]):not([type="file"])', '.editor-form textarea', '.editor-form select', '.editor-note h3', '.editor-footer .muted'], true);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('button', { name: 'Categories', exact: true }).click();
  await expectReadable(page, ['.category-card-body h2', '.category-card-body p', '.category-count'], true);
  await page.getByRole('button', { name: 'Edit category', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Edit category', exact: true })).toBeVisible();
  await expectReadable(page, ['.modal-heading h2', '.category-form label', '.category-form input', '.category-form textarea'], true);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Open my profile', exact: true }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  await expectReadable(page, ['.account-identity h2', '.account-identity p', '.account-role', '.account-settings label', '#account-name', '#account-email', '.account-hint', '.account-mini p', '.account-privacy'], true);
});

test('keyboard users can switch theme and open their profile', async ({ page }) => {
  await backend(page, { savedTheme: 'light' });
  await openAdmin(page);
  const toggle = page.getByRole('button', { name: 'Switch to dark mode', exact: true });
  await page.keyboard.press('Tab');
  await toggle.focus();
  await expect(toggle).toBeFocused();
  const focusAppearance = await toggle.evaluate(element => ({
    visible: element.matches(':focus-visible'),
    width: Number.parseFloat(getComputedStyle(element).outlineWidth),
    style: getComputedStyle(element).outlineStyle,
  }));
  expect(focusAppearance).toMatchObject({ visible: true, style: 'solid' });
  expect(focusAppearance.width).toBeGreaterThanOrEqual(2);
  const focusColors = await colors(toggle, undefined, 'outlineColor');
  expect(focusColors.contrast, `Light keyboard focus outline: ${JSON.stringify(focusColors)}`).toBeGreaterThanOrEqual(3);
  await page.keyboard.press('Space');
  await expectTheme(page, 'dark');
  const profile = page.getByRole('button', { name: 'Open my profile', exact: true });
  await profile.focus();
  await expect(profile).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'My profile.', exact: true })).toBeVisible();
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
});

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }, { width: 844, height: 390 }]) {
  test(`light and dark fixture layouts remain usable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await backend(page, { savedTheme: 'light', displayName: 'A long fixture display name for narrow screens' });
    await openAdmin(page);
    for (const theme of ['light', 'dark'] as const) {
      if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
      await expectTheme(page, theme);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} document overflow`).toBe(true);
      const collisions = await page.locator('.topbar').evaluate(header => {
        const selectors = ['.breadcrumbs', '.connection-pill', '.catalog-link', '.header-profile', '[aria-label="Switch to dark mode"]', '[aria-label="Switch to light mode"]', '[aria-label="Sign out"]'];
        const boxes = selectors.flatMap(selector => {
          const element = header.querySelector(selector);
          if (!element || getComputedStyle(element).display === 'none') return [];
          const rect = element.getBoundingClientRect();
          return rect.width && rect.height ? [{ selector, rect }] : [];
        });
        return boxes.flatMap((a, index) => boxes.slice(index + 1).filter(b =>
          a.rect.left < b.rect.right - 1 && b.rect.left < a.rect.right - 1 && a.rect.top < b.rect.bottom - 1 && b.rect.top < a.rect.bottom - 1,
        ).map(b => `${a.selector} overlaps ${b.selector}`));
      });
      expect(collisions, `${theme} header controls overlap`).toEqual([]);
      const escaped = await page.locator('.topbar').evaluate(header => {
        const frame = header.getBoundingClientRect();
        return Array.from(header.querySelectorAll('.topbar-actions button')).filter(button => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && (rect.left < frame.left - 1 || rect.right > frame.right + 1 || rect.top < frame.top - 1 || rect.bottom > frame.bottom + 1);
        }).map(button => button.getAttribute('aria-label') || button.textContent);
      });
      expect(escaped, `${theme} header controls must fit their header`).toEqual([]);
      await expect(page.getByRole('button', { name: 'Open my profile', exact: true })).toBeVisible();
      const screenshot = testInfo.outputPath(`admin-test-fixtures-${theme}-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach(`admin fixture ${theme} ${viewport.width}x${viewport.height}`, { path: screenshot, contentType: 'image/png' });
      if (viewport.width <= 390) {
        const escapedTableText = await page.locator('tbody tr').first().evaluate(row => {
          const textElements = Array.from(row.querySelectorAll('.product-cell strong, .product-cell small'));
          const categoryCell = row.children[1];
          if (categoryCell) textElements.push(categoryCell);
          return textElements.flatMap(element => {
            const cell = element.closest('td');
            if (!cell) return [];
            const range = document.createRange();
            range.selectNodeContents(element);
            const text = range.getBoundingClientRect(), bounds = cell.getBoundingClientRect();
            return text.left < bounds.left - 1 || text.right > bounds.right + 1
              ? [{ text: element.textContent?.trim(), textLeft: text.left, textRight: text.right, cellLeft: bounds.left, cellRight: bounds.right }]
              : [];
          });
        });
        expect(escapedTableText, `${theme} product and category text must remain within their table cells`).toEqual([]);
        const wrapping = await page.locator('.product-cell').first().evaluate(product => {
          const lines = (selector: string) => {
            const text = product.querySelector(selector);
            if (!text) return 0;
            const range = document.createRange();
            range.selectNodeContents(text);
            return range.getClientRects().length;
          };
          return { nameLines: lines('strong'), skuLines: lines('small'), rowHeight: product.closest('tr')!.getBoundingClientRect().height };
        });
        // A short fixture name and SKU should stay readable in a compact scrollable row.
        expect(wrapping.nameLines, `${theme} fixture product name wraps excessively: ${JSON.stringify(wrapping)}`).toBeLessThanOrEqual(3);
        expect(wrapping.skuLines, `${theme} fixture SKU wraps excessively: ${JSON.stringify(wrapping)}`).toBeLessThanOrEqual(2);
        expect(wrapping.rowHeight, `${theme} fixture product row should remain compact`).toBeLessThanOrEqual(140);
      }
    }
    await page.getByRole('button', { name: 'Open my profile', exact: true }).click();
    await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Profile document overflow').toBe(true);
    const toggle = page.getByRole('button', { name: 'Switch to light mode', exact: true });
    await toggle.click();
    await expectTheme(page, 'light');
  });
}
