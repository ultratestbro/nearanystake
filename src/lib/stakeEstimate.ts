// Display-only previews for the Stake card: how much of a delivery ends up staked, what stays on the
// account and what it earns. What is actually staked is decided after the delivery by
// stakeAmountAfterDelivery (stakeAmount.ts) from the module's live numbers; these only preview it.

/** Storage a fresh implicit account holds after the delivery creates it (182 bytes, mainnet tx AQAkvxyT…). */
export const FRESH_ACCOUNT_STORAGE = 182n * 10n ** 19n;

export interface KeptInput {
  /** What a stake keeps back by the module's rules: its upfront gas plus the reserve (`stakeOverhead`). */
  overhead: bigint;
  /** NEAR the account can spend before the delivery arrives (0n when it doesn't exist yet). */
  spendable: bigint;
  /** The account doesn't exist yet: the delivery creates it and its storage stays locked. */
  fresh: boolean;
}

/**
 * NEAR of the delivery that stays on the account instead of being staked: the gas reserve and the
 * stake's prepaid gas, less what the account can already spend (the stake is capped by
 * available − reserve − upfront, so an account that already holds the reserve stakes all of it).
 */
export function keptFromDelivery(i: KeptInput): bigint {
  const need = i.overhead + (i.fresh ? FRESH_ACCOUNT_STORAGE : 0n);
  const kept = need - (i.spendable > 0n ? i.spendable : 0n);
  return kept > 0n ? kept : 0n;
}

/** The delivery minus what stays on the account, never below zero. */
export function stakedFromDelivery(delivered: bigint, kept: bigint): bigint {
  const v = delivered - kept;
  return v > 0n ? v : 0n;
}

/** Liquid tokens `near` (yocto) mints at `price` (yocto per whole token), rounded down; 0n without a price. */
export function sharesFor(near: bigint, price: bigint): bigint {
  return price > 0n ? (near * 10n ** 24n) / price : 0n;
}

/** A year's reward on `amount` at `aprPercent` (5.02 = 5.02 %), same base units. */
export function yearlyReward(amount: bigint, aprPercent: number | null | undefined): bigint {
  if (aprPercent === null || aprPercent === undefined || !Number.isFinite(aprPercent) || aprPercent <= 0) return 0n;
  return (amount * BigInt(Math.round(aprPercent * 100))) / 10_000n;
}

/** NEAR worth `usd` at `nearUsd` per NEAR, in yocto; null without both prices. */
export function nearForUsd(usd: number | null, nearUsd: number | null | undefined): bigint | null {
  if (usd === null || nearUsd === null || nearUsd === undefined || !(usd > 0) || !(nearUsd > 0)) return null;
  return BigInt(Math.floor((usd / nearUsd) * 1e8)) * 10n ** 16n;
}
