import { describe, expect, it } from "vitest";
import dryNear from "./__fixtures__/oneclick/quote-dry-base-usdc-near.json";
import pending from "./__fixtures__/oneclick/status-pending-expired.json";
import { canGoLive, depositAddressToShow, initialDryRun } from "./dryrun";
import type { QuoteResponse } from "./oneclick/types";

const dry = dryNear.response as unknown as QuoteResponse;
const live = pending.response.quoteResponse as unknown as QuoteResponse;

describe("dry-run guard", () => {
  it("never shows an address for a dry quote", () => {
    expect(depositAddressToShow(dry, false)).toBeNull();
    // even if a dry answer carried one
    expect(depositAddressToShow({ ...dry, quote: { ...dry.quote, depositAddress: "0xabc" } }, false)).toBeNull();
  });

  it("never shows an address while dry-run mode is on, even for a live quote", () => {
    expect(depositAddressToShow(live, true)).toBeNull();
  });

  it("shows the live quote's address in live mode", () => {
    expect(depositAddressToShow(live, false)).toBe("0x62F099A5C804f165351eE84CA41239b4283fAe1a");
  });

  it("live mode needs a NEAR account; without a wallet the app is always dry", () => {
    expect(canGoLive(null)).toBe(false);
    expect(canGoLive("")).toBe(false);
    expect(canGoLive("alice.near")).toBe(true);
    expect(initialDryRun(null, null)).toBe(true);
    expect(initialDryRun(null, false)).toBe(true);
    expect(initialDryRun(null, true)).toBe(true);
    expect(initialDryRun("", false)).toBe(true);
  });

  it("a connected wallet goes live unless the user chose dry run before", () => {
    // connecting a wallet is itself the opt-in to live mode (no second click on the header switch);
    // the deposit-address and `dry: false` guards above still hold in either mode
    expect(initialDryRun("alice.near", null)).toBe(false);
    expect(initialDryRun("alice.near", false)).toBe(false);
    expect(initialDryRun("alice.near", true)).toBe(true);
  });
});
