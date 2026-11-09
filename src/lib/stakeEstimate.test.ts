import { describe, expect, it } from "vitest";
import { FRESH_ACCOUNT_STORAGE, keptFromDelivery, nearForUsd, sharesFor, stakedFromDelivery, yearlyReward } from "./stakeEstimate";
import { stakeAmountAfterDelivery } from "./stakeAmount";

const NEAR = 10n ** 24n;
const MIN = 10n ** 21n;
// ≈ 0.16 NEAR on mainnet (Nov 2026): the stake's prepaid gas (~0.055) + the reserve for [withdraw_all, unstake] (~0.11)
const OVERHEAD = 16n * 10n ** 22n;

describe("the Stake card's preview of a delivery", () => {
  it("an empty existing account keeps the overhead; a fresh one its storage too", () => {
    expect(keptFromDelivery({ overhead: OVERHEAD, spendable: 0n, fresh: false })).toBe(OVERHEAD);
    expect(keptFromDelivery({ overhead: OVERHEAD, spendable: 0n, fresh: true })).toBe(OVERHEAD + FRESH_ACCOUNT_STORAGE);
  });

  it("an account that already holds the reserve keeps nothing of the delivery", () => {
    expect(keptFromDelivery({ overhead: OVERHEAD, spendable: 2n * NEAR, fresh: false })).toBe(0n);
    expect(keptFromDelivery({ overhead: OVERHEAD, spendable: 3n * 10n ** 22n, fresh: false })).toBe(13n * 10n ** 22n);
  });

  it("matches what stakeAmountAfterDelivery stakes for the same account", () => {
    const delivered = 537_430n * 10n ** 18n;
    for (const spendable of [0n, 10n ** 22n, 4n * 10n ** 22n, NEAR]) {
      const kept = keptFromDelivery({ overhead: OVERHEAD, spendable, fresh: false });
      const real = stakeAmountAfterDelivery({ reported: delivered, onChain: null, maxStakeable: spendable + delivered - OVERHEAD, minStake: MIN });
      expect(stakedFromDelivery(delivered, kept)).toBe(real.amount);
    }
  });

  it("never previews a negative stake", () => {
    expect(stakedFromDelivery(10n ** 22n, OVERHEAD)).toBe(0n);
  });

  it("liquid tokens at the token price, rounded down", () => {
    // 1 rNEAR = 1.0685 NEAR
    expect(sharesFor(10_685n * 10n ** 20n, 10_685n * 10n ** 20n)).toBe(NEAR);
    expect(sharesFor(NEAR, 0n)).toBe(0n);
  });

  it("a year's reward at the APR", () => {
    expect(yearlyReward(129n * 10n ** 22n, 5.02)).toBe(64_758n * 10n ** 18n);
    expect(yearlyReward(NEAR, null)).toBe(0n);
    expect(yearlyReward(NEAR, -1)).toBe(0n);
  });

  it("NEAR for a dollar amount, null without prices", () => {
    expect(nearForUsd(5, 3.72)).toBe(134_408_602n * 10n ** 16n);
    expect(nearForUsd(null, 3.72)).toBeNull();
    expect(nearForUsd(5, undefined)).toBeNull();
    expect(nearForUsd(0, 3.72)).toBeNull();
  });
});
