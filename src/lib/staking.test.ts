import { NotImplementedError, ReadOnlyAccountError } from "@anywalletkit/core";
import { describe, expect, it, vi } from "vitest";
import { watchAccount } from "./near/selector-account";
import { PreviewWriteError, _bridge, backendUsage, nativeStaking, poolStatus, stakingErrorText } from "./staking";
import { NearStakingError, type NearPoolInfo } from "@anywalletkit/protocol-staking-native-near";

describe("the staking adapter", () => {
  it("a read the SDK hasn't implemented yet is served by the preview, and says so", async () => {
    const preview = vi.fn(async () => 42);
    const read = _bridge("test.read", async () => {
      throw new NotImplementedError("read()");
    }, preview);
    await expect(read()).resolves.toBe(42);
    expect(backendUsage().preview).toContain("test.read");
  });

  it("an implemented SDK method answers, the preview is never asked", async () => {
    const preview = vi.fn(async () => 0);
    await expect(_bridge("test.sdk", async () => 7, preview)()).resolves.toBe(7);
    expect(preview).not.toHaveBeenCalled();
    expect(backendUsage().sdk).toContain("test.sdk");
  });

  it("writes never fall back: an unimplemented write refuses instead of signing anything else", async () => {
    const write = _bridge("test.write", async () => {
      throw new NotImplementedError("stake()");
    });
    await expect(write()).rejects.toBeInstanceOf(PreviewWriteError);
  });

  it("SDK refusals pass through untouched (no fallback on a real refusal)", async () => {
    const preview = vi.fn(async () => 1);
    const err = new NearStakingError("pool-not-allowed", "nope", { refusals: ["paused"] });
    await expect(_bridge("test.refusal", async () => Promise.reject(err), preview)()).rejects.toBe(err);
    expect(preview).not.toHaveBeenCalled();
    expect(stakingErrorText(err)).toBe("This pool can't take new stake: staking paused by its owner.");
  });

  it("a read-only demo account can't stake: the module refuses before anything is built", async () => {
    const s = nativeStaking(watchAccount("nima.near", "mainnet"), { provider: async () => ({}), discover: false });
    await expect(s.stake({ amount: 10n ** 24n, pool: "astro-stakers.poolv1.near" })).rejects.toBeInstanceOf(ReadOnlyAccountError);
  });

  it("pool status labels follow the module's refusals", () => {
    const p = (refusals: NearPoolInfo["refusals"], extra: Partial<NearPoolInfo> = {}) => ({ refusals, details: true, eligible: refusals.length === 0, ...extra }) as NearPoolInfo;
    expect(poolStatus(p([])).label).toBe("Eligible");
    expect(poolStatus(p(["pause-unknown"])).label).toBe("Paused");
    expect(poolStatus(p(["unknown-code"])).label).toBe("Not allowed");
    expect(poolStatus(p(["fee-above-max"])).label).toBe("Fee too high");
    expect(poolStatus(p(["not-in-next-set"])).label).toBe("Leaving set");
  });
});
