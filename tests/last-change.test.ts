import { describe, expect, it } from "vitest";
import { activityLabel, formatActivityTime } from "../src/components/LastChange";

describe("sidebar last change presentation", () => {
  it("uses explicit Malaysia local time regardless of browser timezone", () => {
    const formatted = formatActivityTime("2026-10-14T02:30:00.000Z");
    expect(formatted).toContain("14 Oct 2026");
    expect(formatted).toMatch(/10:30\s*am/i);
    expect(formatted).toContain("MYT");
  });
  it("never invents a date from invalid values", () => {
    expect(formatActivityTime("not-a-date")).toBe("Time unavailable");
  });
  it("identifies additions, edits, publishing and deletions", () => {
    expect(activityLabel({ action: "products_created", resource_type: "products" })).toBe("Product added");
    expect(activityLabel({ action: "products_updated", resource_type: "products" })).toBe("Product edited");
    expect(activityLabel({ action: "product_published", resource_type: "products" })).toBe("Product published");
    expect(activityLabel({ action: "products_deleted", resource_type: "products" })).toBe("Product deleted");
  });
});
