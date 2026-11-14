import { describe, expect, it } from "vitest";
import { getUpdateActivity } from "../src/components/CatalogOverviewStudio";

describe("Catalog overview activity is based on real product timestamps", () => {
  it("counts each product once using only its most recent update", () => {
    const asOfMs = Date.parse("2026-11-14T06:00:00Z");
    const activity = getUpdateActivity([
      { updatedAt: "2026-11-13T12:00:00Z" },
      { updatedAt: "2026-11-14T03:00:00Z" },
      { updatedAt: "2026-09-01T06:00:00Z" },
      { updatedAt: "not-a-real-date" },
      { updatedAt: "2026-11-15T00:00:00Z" },
    ], 7, asOfMs);
    expect(activity.keys).toHaveLength(7);
    expect(activity.total).toBe(2);
    expect(activity.cumulative.at(-1)).toBe(2);
    expect(activity.cumulative.every((value, index, values) =>
      index === 0 || value >= values[index - 1])).toBe(true);
  });

  it("groups records by Malaysia date, not the server's UTC day", () => {
    const result = getUpdateActivity([
      { updatedAt: "2026-11-13T16:01:00Z" },
    ], 1, Date.parse("2026-11-14T00:10:00Z"));
    expect(result.keys).toEqual(["2026-11-14"]);
    expect(result.cumulative).toEqual([1]);
  });

  it("renders zero activity without inventing growth or history", () => {
    const result = getUpdateActivity([
      { updatedAt: "2020-01-01T00:00:00Z" },
    ], 30, Date.parse("2026-11-14T06:00:00Z"));
    expect(result.total).toBe(0);
    expect(result.cumulative.every(count => count === 0)).toBe(true);
  });
});
