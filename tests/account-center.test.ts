import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  user: { id: "user-one", email: "integrator.brutti@gmail.com", user_metadata: { full_name: "Brutti Integrator" }, last_sign_in_at: null },
  getUser: vi.fn(), getAuthState: vi.fn(), updateUser: vi.fn(), rpc: vi.fn(), from: vi.fn(),
}));
vi.mock("../src/lib/catalog", () => ({
  getAuthState: mock.getAuthState,
  catalogClient: () => ({
    auth: { getUser: mock.getUser, updateUser: mock.updateUser },
    rpc: mock.rpc, from: mock.from,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.getUser.mockResolvedValue({ data: { user: mock.user }, error: null });
  mock.getAuthState.mockResolvedValue({ authenticated: true, isAdmin: true, email: "integrator.brutti@gmail.com" });
  mock.from.mockReturnValue({
    select: () => ({
      order: () => ({
        limit: async () => ({ data: [{
          id: "e1", actor_id: "user-one", actor_email: "integrator.brutti@gmail.com",
          action: "products_created", resource_type: "products",
          resource_name: "Rack A", created_at: "2026-10-14T04:00:00.000Z",
        }], error: null }),
      }),
    }),
  });
  mock.rpc.mockImplementation(async (fn: string) =>
    fn === "catalog_my_role"
      ? { data: "super_admin", error: null }
      : { data: [], error: null });
  mock.updateUser.mockResolvedValue({ error: null });
});

describe("catalog identities and staff management", () => {
  it("never uses email alone to infer super admin", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "RPC missing" } });
    const { getAccountSummary } = await import("../src/lib/account-center");
    expect(await getAccountSummary()).toMatchObject({
      email: "integrator.brutti@gmail.com",
      role: null,
      managementReady: false,
      displayName: "Brutti Integrator",
    });
  });

  it("shows the role returned by the server", async () => {
    const { getAccountSummary } = await import("../src/lib/account-center");
    expect(await getAccountSummary()).toMatchObject({
      role: "super_admin", managementReady: true, id: "user-one",
    });
  });

  it("only modifies its own authenticated display name, not role or email", async () => {
    const { updateOwnDisplayName } = await import("../src/lib/account-center");
    await expect(updateOwnDisplayName("  Wani  Brutti  ")).resolves.toBe("Wani Brutti");
    expect(mock.updateUser).toHaveBeenCalledExactlyOnceWith({ data: { full_name: "Wani Brutti" } });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("rejects blank and oversized names", async () => {
    const { updateOwnDisplayName } = await import("../src/lib/account-center");
    await expect(updateOwnDisplayName(" ")).rejects.toThrow(/Display name/);
    await expect(updateOwnDisplayName("a".repeat(81))).rejects.toThrow(/Display name/);
    expect(mock.updateUser).not.toHaveBeenCalled();
  });

  it("refuses unauthorized role updates and avoids contacting the role-mutation RPC", async () => {
    mock.rpc.mockImplementation(async (fn: string) => fn === "catalog_my_role"
      ? { data: "editor", error: null } : { data: null, error: null });
    const { updateStaffRole } = await import("../src/lib/account-center");
    await expect(updateStaffRole("user-two", "super_admin")).rejects.toThrow(/Super Admin/);
    expect(mock.rpc).not.toHaveBeenCalledWith("catalog_set_staff_role", expect.anything());
  });

  it("refuses changing the signed-in user's own role", async () => {
    const { updateStaffRole } = await import("../src/lib/account-center");
    await expect(updateStaffRole("user-one", "admin")).rejects.toThrow(/own role/);
    expect(mock.rpc).not.toHaveBeenCalledWith("catalog_set_staff_role", expect.anything());
  });

  it("sends staff role changes to the server-side gated RPC only", async () => {
    const { updateStaffRole } = await import("../src/lib/account-center");
    await updateStaffRole("user-two", "editor");
    expect(mock.rpc).toHaveBeenCalledWith("catalog_set_staff_role", {
      p_user_id: "user-two", p_role: "editor",
    });
  });

  it("does not retrieve a staff directory unless the server granted super admin access", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "RPC not installed" } });
    const { listCatalogStaff } = await import("../src/lib/account-center");
    await expect(listCatalogStaff()).rejects.toThrow(/Super Admin/);
    expect(mock.rpc).not.toHaveBeenCalledWith("catalog_list_staff");
  });

  it("renders a safe short display name when no account name is configured", async () => {
    const { safeDisplayName, initials, roleLabel } = await import("../src/lib/account-center");
    expect(safeDisplayName({ email: "user@example.com", user_metadata: {} })).toBe("user");
    expect(initials("Brutti Integrator")).toBe("BI");
    expect(roleLabel(null)).not.toBe("Super Admin");
  });
});

describe("catalog audit access", () => {
  it("reads actual activity for an approved catalog admin before role migration", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Role RPC missing" } });
    const { listCatalogActivity, getLatestCatalogActivity } = await import("../src/lib/account-center");
    await expect(getLatestCatalogActivity()).resolves.toMatchObject({
      actor_email: "integrator.brutti@gmail.com", action: "products_created", resource_name: "Rack A",
    });
    await expect(listCatalogActivity()).resolves.toHaveLength(1);
    expect(mock.from).toHaveBeenCalledWith("catalog_activity");
  });
  it("refuses activity history when membership is not verified", async () => {
    mock.getAuthState.mockResolvedValue({ authenticated: true, isAdmin: false });
    const { listCatalogActivity, getLatestCatalogActivity } = await import("../src/lib/account-center");
    await expect(listCatalogActivity()).rejects.toThrow(/approved catalog administrator/);
    await expect(getLatestCatalogActivity()).rejects.toThrow(/approved catalog administrator/);
    expect(mock.from).not.toHaveBeenCalledWith("catalog_activity");
  });
});
