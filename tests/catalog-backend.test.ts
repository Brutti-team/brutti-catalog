import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCatalog } from "../src/data/demo";

const fake = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
  from: vi.fn(),
  storageFrom: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    fake.createClient(...args);
    return {
      auth: {
        getUser: fake.getUser,
        signInWithPassword: fake.signInWithPassword,
        signOut: fake.signOut,
        onAuthStateChange: fake.onAuthStateChange,
      },
      from: fake.from,
      storage: { from: fake.storageFrom },
    };
  },
}));

function adminQuery(
  data: unknown = { user_id: "admin-uuid" },
  error: unknown = null,
) {
  return {
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data, error }) }),
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-anon-key");
  vi.stubEnv("VITE_DEMO_MODE", "false");
  fake.getUser.mockResolvedValue({
    data: { user: { id: "admin-uuid", email: "admin@example.com" } },
    error: null,
  });
  fake.from.mockImplementation((table: string) =>
    table === "catalog_admins" ? adminQuery() : undefined,
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("configured Supabase catalog", () => {
  it("performs no backend mutation or connection during module import", async () => {
    const catalog = await import("../src/lib/catalog");
    expect(catalog.isDemoMode).toBe(false);
    expect(fake.createClient).not.toHaveBeenCalled();
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("never substitutes sample products when the backend fails", async () => {
    fake.from.mockImplementation(() => ({
      select: () => ({
        order: async () => ({
          data: null,
          error: { message: "Connection unavailable" },
        }),
      }),
    }));
    const { loadCatalog } = await import("../src/lib/catalog");
    await expect(loadCatalog()).rejects.toThrow(/Connection unavailable/);
  });

  it("rejects partial configuration instead of silently changing to demo", async () => {
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    const catalog = await import("../src/lib/catalog");
    expect(catalog.isDemoMode).toBe(false);
    await expect(catalog.loadCatalog()).rejects.toThrow(
      /both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY/,
    );
  });

  it("keeps the UI mounted when auth subscriptions encounter missing configuration", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    const catalog = await import("../src/lib/catalog");
    expect(() => catalog.subscribeAuth(() => undefined)()).not.toThrow();
    await expect(catalog.getAuthState()).rejects.toThrow(/Set both/);
  });

  it("requires database admin membership rather than trusting an authenticated account", async () => {
    fake.from.mockImplementation(() => adminQuery(null));
    const catalog = await import("../src/lib/catalog");
    expect(await catalog.getAuthState()).toEqual({
      authenticated: true,
      isAdmin: false,
      email: "admin@example.com",
    });
    await expect(catalog.saveProduct(demoCatalog.products[0])).rejects.toThrow(
      /administrator/i,
    );
    expect(
      fake.from.mock.calls.every(([table]) => table === "catalog_admins"),
    ).toBe(true);
  });

  it("fails closed when admin membership cannot be checked", async () => {
    fake.from.mockImplementation(() =>
      adminQuery(null, { message: "Permission lookup failed" }),
    );
    const { getAuthState } = await import("../src/lib/catalog");
    await expect(getAuthState()).rejects.toThrow(/verify admin access/);
  });

  it("returns signed-out state only for a missing session", async () => {
    fake.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthSessionMissingError" },
    });
    const { getAuthState } = await import("../src/lib/catalog");
    expect(await getAuthState()).toEqual({
      authenticated: false,
      isAdmin: false,
    });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("blocks category and image writes when the user is not an administrator", async () => {
    fake.from.mockImplementation(() => adminQuery(null));
    const catalog = await import("../src/lib/catalog");
    await expect(
      catalog.saveCategory(demoCatalog.categories[0]),
    ).rejects.toThrow(/administrator/i);
    await expect(catalog.deleteCategory("category")).rejects.toThrow(
      /administrator/i,
    );
    await expect(catalog.deleteProduct("product")).rejects.toThrow(
      /administrator/i,
    );
    await expect(
      catalog.uploadImage(
        new File(["image"], "file.jpg", { type: "image/jpeg" }),
      ),
    ).rejects.toThrow(/administrator/i);
    expect(fake.storageFrom).not.toHaveBeenCalled();
    expect(
      fake.from.mock.calls.every(([table]) => table === "catalog_admins"),
    ).toBe(true);
  });

  it("delegates credentials to Supabase authentication", async () => {
    fake.signInWithPassword.mockResolvedValue({ error: null });
    fake.signOut.mockResolvedValue({ error: null });
    const catalog = await import("../src/lib/catalog");
    await catalog.signIn(" admin@example.com ", "password");
    await catalog.signOut();
    expect(fake.signInWithPassword).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "password",
    });
    expect(fake.signOut).toHaveBeenCalledOnce();
  });

  it("defers auth notifications until Supabase releases its authentication lock", async () => {
    vi.useFakeTimers();
    let emit: (() => void) | undefined;
    const unsubscribe = vi.fn();
    fake.onAuthStateChange.mockImplementation((callback: () => void) => {
      emit = callback;
      return { data: { subscription: { unsubscribe } } };
    });
    const catalog = await import("../src/lib/catalog");
    const listener = vi.fn();
    const cleanup = catalog.subscribeAuth(listener);
    emit!();
    expect(listener).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(listener).toHaveBeenCalledOnce();
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
