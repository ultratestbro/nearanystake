// The one place the app touches the Any Wallet Kit staking modules.
//
// Every component calls `nativeStaking()` / `liquidStaking()` and gets an object with the module's
// method names and shapes (NEAR-STAKING-API.md). Today the packages come from vendor/ tarballs of
// feat/near-staking; while a method there still throws NotImplementedError, its read or quote is served by
// the preview backend (./staking/preview.ts, live view calls, never signs). Writes always go to the
// module. Switching to the finished packages is a repack (or the npm version) and, at most,
// NEXT_PUBLIC_STAKING_BACKEND=sdk to drop the fallback.

import type { IWalletAccount, IWalletAccountReadOnly } from "@anywalletkit/core";
import {
  DEFAULT_RESERVE, MIN_STAKE, NativeStakingProtocolNear, NearStakingError, NUM_EPOCHS_TO_UNLOCK,
  type NativeStakingNearConfig, type NearPoolInfo, type PoolRefusal,
} from "@anywalletkit/protocol-staking-native-near";
import { LiquidStakingError, LiquidStakingProtocolNear, LIQUID_PRESETS } from "@anywalletkit/protocol-staking-liquid-near";
import { createNearHistory } from "@anywalletkit/wallet-near/history";
import { nearProviders } from "./near/config";
import { PreviewLiquidStaking, PreviewNativeStaking, PreviewWriteError, isNotImplemented } from "./staking/preview";

export { DEFAULT_RESERVE, MIN_STAKE, NUM_EPOCHS_TO_UNLOCK, NearStakingError, LiquidStakingError, PreviewWriteError };
export type {
  NearEpoch, NearPoolInfo, NearPoolPosition, NearStakeQuote, NearUnstakeQuote, NearClaimQuote, NearWithdrawalRequest, PoolRefusal, UnlockEstimate,
  NearStakingWarning, NearNetworkStats,
} from "@anywalletkit/protocol-staking-native-near";
export type { LiquidPoolInfo, LiquidAccountDetails, LiquidStakeQuote, LiquidUnstakeQuote, LiquidClaimQuote, LiquidWithdrawalRequest, LiquidStakingWarning } from "@anywalletkit/protocol-staking-liquid-near";

type Mode = "auto" | "sdk" | "preview";
const MODE: Mode = ((): Mode => {
  const m = process.env.NEXT_PUBLIC_STAKING_BACKEND;
  return m === "sdk" || m === "preview" ? m : "auto";
})();

// which backend answered each method last: the footer badge says honestly when preview data is shown
const used = new Map<string, "sdk" | "preview">();
const listeners = new Set<() => void>();
function note(method: string, by: "sdk" | "preview") {
  if (used.get(method) === by) return;
  used.set(method, by);
  for (const l of listeners) l();
}
export function backendUsage(): { mode: Mode; preview: string[]; sdk: string[] } {
  const all = [...used.entries()];
  return { mode: MODE, preview: all.filter(([, b]) => b === "preview").map(([m]) => m), sdk: all.filter(([, b]) => b === "sdk").map(([m]) => m) };
}
export function onBackendUsage(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Exported for tests only. */
export function _bridge<A extends unknown[], R>(name: string, sdk: (...a: A) => Promise<R>, preview?: (...a: A) => Promise<R>) {
  return bridge(name, sdk, preview);
}

function bridge<A extends unknown[], R>(name: string, sdk: (...a: A) => Promise<R>, preview?: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
  return async (...a: A) => {
    if (MODE === "preview" && preview) {
      note(name, "preview");
      return preview(...a);
    }
    try {
      const r = await sdk(...a);
      note(name, "sdk");
      return r;
    } catch (e) {
      if (!isNotImplemented(e)) throw e;
      if (preview && MODE === "auto") {
        note(name, "preview");
        return preview(...a);
      }
      throw new PreviewWriteError(name);
    }
  };
}

type Account = IWalletAccountReadOnly | IWalletAccount;

/** Native staking for `account`: any standard pool the module's allow-list accepts, mainnet. */
// one history source for the session: keyless nearblocks allows a few requests a minute
let history: ReturnType<typeof createNearHistory> | null = null;

export function nativeStaking(account: Account, extra: Partial<NativeStakingNearConfig> = {}) {
  history ??= createNearHistory({ network: "mainnet" });
  // history dates the last unstake, so the countdown shows the exact unlock epoch instead of a 1–4 epoch range
  const config: NativeStakingNearConfig = { pools: "any", provider: nearProviders(), discover: "fastnear", history, ...extra };
  const sdk = new NativeStakingProtocolNear(account, config);
  const p = new PreviewNativeStaking(account, config);
  return {
    get network() {
      return sdk.network;
    },
    reserve: sdk.reserve,
    maxFee: sdk.maxFee,
    getEpoch: bridge("native.getEpoch", () => sdk.getEpoch(), () => p.getEpoch()),
    getNetworkStats: bridge("native.getNetworkStats", () => sdk.getNetworkStats(), () => p.getNetworkStats()),
    listPools: bridge("native.listPools", () => sdk.listPools(), () => p.listPools()),
    getPool: bridge("native.getPool", (id: string) => sdk.getPool(id), (id: string) => p.getPool(id)),
    getPools: bridge("native.getPools", (ids: string[]) => sdk.getPools(ids), (ids: string[]) => p.getPools(ids)),
    listPositions: bridge("native.listPositions", (o?: { pools?: string[] }) => sdk.listPositions(o), (o?: { pools?: string[] }) => p.listPositions(o)),
    getMaxStakeable: bridge("native.getMaxStakeable", () => sdk.getMaxStakeable(), () => p.getMaxStakeable()),
    getApr: bridge("native.getApr", (o?: { pool?: string }) => sdk.getApr(o), (o?: { pool?: string }) => p.getApr(o)),
    getStakedBalance: bridge("native.getStakedBalance", () => sdk.getStakedBalance(), () => p.getStakedBalance()),
    getWithdrawalRequests: bridge("native.getWithdrawalRequests", () => sdk.getWithdrawalRequests(), () => p.getWithdrawalRequests()),
    quoteStake: bridge("native.quoteStake", (o: Parameters<typeof sdk.quoteStake>[0]) => sdk.quoteStake(o), (o: Parameters<typeof sdk.quoteStake>[0]) => p.quoteStake(o)),
    stake: bridge("native.stake", (o: Parameters<typeof sdk.stake>[0]) => sdk.stake(o)),
    quoteRequestWithdrawal: bridge(
      "native.quoteRequestWithdrawal",
      (o: Parameters<typeof sdk.quoteRequestWithdrawal>[0]) => sdk.quoteRequestWithdrawal(o),
      (o: Parameters<typeof sdk.quoteRequestWithdrawal>[0]) => p.quoteRequestWithdrawal(o),
    ),
    requestWithdrawal: bridge("native.requestWithdrawal", (o: Parameters<typeof sdk.requestWithdrawal>[0]) => sdk.requestWithdrawal(o)),
    quoteClaimWithdrawals: bridge(
      "native.quoteClaimWithdrawals",
      (o?: Parameters<typeof sdk.quoteClaimWithdrawals>[0]) => sdk.quoteClaimWithdrawals(o),
      (o?: Parameters<typeof sdk.quoteClaimWithdrawals>[0]) => p.quoteClaimWithdrawals(o),
    ),
    claimWithdrawals: bridge("native.claimWithdrawals", (o?: Parameters<typeof sdk.claimWithdrawals>[0]) => sdk.claimWithdrawals(o)),
  };
}
export type NativeStaking = ReturnType<typeof nativeStaking>;

export type LiquidPreset = keyof typeof LIQUID_PRESETS;
export const LIQUID_OPTIONS: Array<{ id: LiquidPreset; symbol: string; label: string; contract: string; note: string }> = [
  { id: "rnear", symbol: "rNEAR", label: "Rhea rNEAR", contract: LIQUID_PRESETS.rnear.contracts.mainnet.contract, note: "Rhea's liquid staking token (5 % protocol fee)" },
  { id: "linear", symbol: "LiNEAR", label: "LiNEAR", contract: LIQUID_PRESETS.linear.contracts.mainnet.contract, note: "LiNEAR Protocol's liquid staking token (6 % protocol fee)" },
];

/** Liquid staking through a LiNEAR-family contract (rNEAR or LiNEAR), pinned by account id and code hash. */
export function liquidStaking(account: Account, pool: LiquidPreset) {
  const config = { pool, provider: nearProviders() };
  const sdk = new LiquidStakingProtocolNear(account, config);
  const p = new PreviewLiquidStaking(account, config);
  return {
    pool: sdk.pool,
    getEpoch: bridge(`${pool}.getEpoch`, () => sdk.getEpoch(), () => p.getEpoch()),
    getPoolInfo: bridge(`${pool}.getPoolInfo`, () => sdk.getPoolInfo(), () => p.getPoolInfo()),
    getAccountDetails: bridge(`${pool}.getAccountDetails`, () => sdk.getAccountDetails(), () => p.getAccountDetails()),
    getMaxStakeable: bridge(`${pool}.getMaxStakeable`, () => sdk.getMaxStakeable(), () => p.getMaxStakeable()),
    getApr: bridge(`${pool}.getApr`, () => sdk.getApr(), () => p.getApr()),
    getStakedBalance: bridge(`${pool}.getStakedBalance`, () => sdk.getStakedBalance(), () => p.getStakedBalance()),
    getWithdrawalRequests: bridge(`${pool}.getWithdrawalRequests`, () => sdk.getWithdrawalRequests(), () => p.getWithdrawalRequests()),
    quoteStake: bridge(`${pool}.quoteStake`, (o: Parameters<typeof sdk.quoteStake>[0]) => sdk.quoteStake(o), (o: Parameters<typeof sdk.quoteStake>[0]) => p.quoteStake(o)),
    stake: bridge(`${pool}.stake`, (o: Parameters<typeof sdk.stake>[0]) => sdk.stake(o)),
    quoteRequestWithdrawal: bridge(
      `${pool}.quoteRequestWithdrawal`,
      (o: Parameters<typeof sdk.quoteRequestWithdrawal>[0]) => sdk.quoteRequestWithdrawal(o),
      (o: Parameters<typeof sdk.quoteRequestWithdrawal>[0]) => p.quoteRequestWithdrawal(o),
    ),
    requestWithdrawal: bridge(`${pool}.requestWithdrawal`, (o: Parameters<typeof sdk.requestWithdrawal>[0]) => sdk.requestWithdrawal(o)),
    quoteClaimWithdrawals: bridge(`${pool}.quoteClaimWithdrawals`, () => sdk.quoteClaimWithdrawals(), () => p.quoteClaimWithdrawals()),
    claimWithdrawals: bridge(`${pool}.claimWithdrawals`, (o?: Parameters<typeof sdk.claimWithdrawals>[0]) => sdk.claimWithdrawals(o)),
  };
}
export type LiquidStaking = ReturnType<typeof liquidStaking>;

const REFUSAL_TEXT: Record<PoolRefusal, string> = {
  "not-listed": "not on this app's list",
  "not-factory-pool": "not a standard staking pool (no *.poolv1.near / *.pool.near id)",
  "not-found": "account not found",
  "unknown-code": "runs unknown contract code",
  "pause-unknown": "pause state can't be read",
  paused: "staking paused by its owner",
  "fee-unknown": "fee can't be read",
  "fee-above-max": "fee above 10 %",
  "not-in-current-set": "not validating this epoch",
  "not-in-next-set": "leaving the validator set",
  "low-uptime": "low uptime",
};
export const refusalText = (r: PoolRefusal) => REFUSAL_TEXT[r] ?? r;

/** The pool's state as a short label and tone for lists. */
export function poolStatus(p: NearPoolInfo): { label: string; tone: "accent" | "muted" | "warn" | "danger" } {
  if (p.refusals.includes("paused") || p.refusals.includes("pause-unknown")) return { label: "Paused", tone: "danger" };
  if (p.refusals.includes("unknown-code") || p.refusals.includes("not-factory-pool")) return { label: "Not allowed", tone: "danger" };
  if (p.refusals.includes("fee-above-max")) return { label: "Fee too high", tone: "warn" };
  if (p.refusals.includes("not-in-next-set")) return { label: "Leaving set", tone: "warn" };
  if (p.refusals.includes("not-in-current-set")) return { label: "Joining next", tone: "warn" };
  if (p.details && p.eligible) return { label: "Eligible", tone: "accent" };
  return { label: "Active", tone: "muted" };
}

/** Sentence for any staking refusal, for error banners. */
export function stakingErrorText(e: unknown): string {
  if (e instanceof NearStakingError) {
    if (e.code === "pool-not-allowed" && e.refusals?.length) return `This pool can't take new stake: ${e.refusals.map(refusalText).join(", ")}.`;
    return e.message;
  }
  if (e instanceof LiquidStakingError || e instanceof PreviewWriteError) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  if (/insufficient|InsufficientFunds/i.test(m) || (e as { name?: string })?.name === "InsufficientFundsError") return "Not enough NEAR on the account for this plus gas and the 0.02 NEAR reserve.";
  if (/ReadOnlyAccount/i.test((e as { name?: string })?.name ?? "")) return "This is a read-only demo account: connect your own wallet to sign.";
  return m;
}
