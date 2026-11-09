import { describe, expect, it } from "vitest";
import { DESTINATION_ASSETS, SOURCE_ASSETS, findAsset } from "./assets";

describe("SOURCE_ASSETS", () => {
  it("leaves out the catalog tokens 1Click doesn't list", () => {
    expect(findAsset("eip155:1", "stETH")).toBeUndefined();
    expect(findAsset("eip155:1", "SSV")).toBeUndefined();
    expect(DESTINATION_ASSETS.some((a) => a.symbol === "stETH" || a.symbol === "SSV")).toBe(false);
    expect(findAsset("eip155:1", "wstETH")).toBeDefined();
    expect(SOURCE_ASSETS).toHaveLength(67);
    expect(new Set(SOURCE_ASSETS.map((a) => a.chain)).size).toBe(25);
  });
});
