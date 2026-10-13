import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn(), updateUser: vi.fn(), resetPasswordForEmail: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: (...args: unknown[]) => { fake.createClient(...args); return { auth: fake }; } }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-placeholder");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubGlobal("window", { location: { hash: "#type=invite&access_token=callback-token&refresh_token=callback-refresh", search: "" } });
  fake.getSession.mockResolvedValue({ data: { session: { access_token: "callback-token" } }, error: null });
  fake.getUser.mockResolvedValue({ data: { user: { id: "invited-user" } }, error: null });
  fake.updateUser.mockResolvedValue({ error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("captures invite/recovery fragment intent without treating arbitrary admin routes as a password callback", async () => {
  const { readPasswordIntent } = await import("../src/lib/catalog");
  expect(readPasswordIntent({ hash: "#access_token=mock&type=invite", search: "" })).toBe("invite");
  expect(readPasswordIntent({ hash: "#access_token=mock&type=recovery", search: "" })).toBe("recovery");
  expect(readPasswordIntent({ hash: "", search: "?auth=recovery" })).toBe("recovery");
  expect(readPasswordIntent({ hash: "#/admin", search: "" })).toBeNull();
});
it.each([null, { id: "expired-user" }])("never updates a password when server verification fails", async user => {
  fake.getUser.mockResolvedValue({ data: { user }, error: user ? { message: "expired" } : null });
  const { completePassword } = await import("../src/lib/catalog");
  await expect(completePassword("new-test-password")).rejects.toThrow("expired or invalid");
  expect(fake.updateUser).not.toHaveBeenCalled();
});
it("verifies the real user before changing only the password", async () => {
  const { completePassword } = await import("../src/lib/catalog");
  await completePassword("new-test-password");
  expect(fake.getUser.mock.invocationCallOrder[0]).toBeLessThan(fake.updateUser.mock.invocationCallOrder[0]);
  expect(fake.updateUser).toHaveBeenCalledExactlyOnceWith({ password: "new-test-password" });
});
it("propagates Auth password errors without claiming success", async () => {
  fake.updateUser.mockResolvedValue({ error: { message: "Password policy rejected" } });
  const { completePassword } = await import("../src/lib/catalog");
  await expect(completePassword("new-test-password")).rejects.toThrow("Password policy rejected");
});
it.each(["sb_secret_mock", `header.${btoa(JSON.stringify({ role: "service_role" }))}.signature`])("fails closed before creating a client for privileged browser keys", async key => {
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", key);
  const { completePassword } = await import("../src/lib/catalog");
  await expect(completePassword("new-test-password")).rejects.toThrow("public Supabase browser key");
  expect(fake.createClient).not.toHaveBeenCalled();
});
it("supports the public publishable key alias", async () => {
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_mock");
  const { completePassword } = await import("../src/lib/catalog");
  await completePassword("new-test-password");
  expect(fake.createClient).toHaveBeenCalledWith("https://example.supabase.co", "sb_publishable_mock");
});

it.each([
  "#type=recovery&error=access_denied&error_code=otp_expired",
  "#type=invite&access_token=callback-token&refresh_token=mock&error_code=otp_expired",
  "",
])("does not authorize an existing session for failed or query-only callbacks", async hash => {
  vi.stubGlobal("window", { location: { hash, search: "?auth=recovery" } });
  const { completePassword, hasPasswordCallbackSession } = await import("../src/lib/catalog");
  expect(await hasPasswordCallbackSession()).toBe(false);
  await expect(completePassword("new-test-password")).rejects.toThrow("expired or invalid");
  expect(fake.updateUser).not.toHaveBeenCalled();
});
it("rejects a cached session whose token differs from the callback", async () => {
  fake.getSession.mockResolvedValue({ data: { session: { access_token: "old-cached-token" } }, error: null });
  const { completePassword } = await import("../src/lib/catalog");
  await expect(completePassword("new-test-password")).rejects.toThrow("expired or invalid");
  expect(fake.getUser).not.toHaveBeenCalled();
  expect(fake.updateUser).not.toHaveBeenCalled();
});
