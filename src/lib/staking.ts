// The one place the app touches the Any Wallet Kit staking modules
// (@anywalletkit/protocol-staking-native-near and -liquid-near 0.1.0 from npm). Components get the
// module instances themselves: every read, quote and write is the module's, with its fresh,
// fail-closed checks.

import type { IWalletAccount, IWalletAccountReadOnly } from "@anywalletkit/core";
import {
  DEFAULT_RESERVE, GasPricer, MIN_STAKE, NativeStakingProtocolNear, NearStakingError, NUM_EPOCHS_TO_UNLOCK, UNSTAKED_DUST, costOf,
  type NativeStakingNearConfig, type NearPoolInfo, type PoolRefusal,
} from "@anywalletkit/protocol-staking-native-near";
import type { NearRpc, NearTransaction } from "@anywalletkit/wallet-near";
import { LiquidStakingError, LiquidStakingProtocolNear, LIQUID_PRESETS, type LiquidPresetName } from "@anywalletkit/protocol-staking-liquid-near";
import { createNearHistory } from "@anywalletkit/wallet-near/history";
import { ARCHIVAL_RPC, nearProviders } from "./near/config";

export { DEFAULT_RESERVE, MIN_STAKE, NUM_EPOCHS_TO_UNLOCK, UNSTAKED_DUST, NearStakingError, LiquidStakingError };

let pricer: { rpc: NearRpc; p: GasPricer } | null = null;
/**
 * The NEAR the node holds back when it accepts `txs` (prepaid gas bought at min_gas_purchase_price,
 * 10× the gas price on mainnet), by the modules' own fee model. For the app's own transactions (the
 * wNEAR deposit of "Cash out to any chain").
 */
export async function upfrontGas(rpc: NearRpc, txs: NearTransaction[]): Promise<bigint> {
  if (pricer?.rpc !== rpc) pricer = { rpc, p: new GasPricer(() => rpc) };
  return costOf(txs, await pricer.p.prices()).upfront;
}

/**
 * What a stake keeps back on a fresh account by the module's own rules: the stake's upfront gas plus
 * the reserve (at least one unstake's upfront gas). For the dry-run simulation, where the delivery
 * never reached an account the module could quote.
 */
export async function stakeOverhead(module: { gas: { stake: bigint; unstake: bigint; withdraw: bigint } }, rpc: NearRpc): Promise<bigint> {
  const fc = (methodName: string, args: Record<string, unknown>, gas: bigint) => ({ functionCall: { methodName, args, gas, deposit: 0n } });
  const exitGas = module.gas.unstake > module.gas.withdraw ? module.gas.unstake : module.gas.withdraw;
  const [stake, exit] = await Promise.all([
    upfrontGas(rpc, [{ receiverId: "pool", actions: [fc("deposit_and_stake", {}, module.gas.stake)] }]),
    upfrontGas(rpc, [{ receiverId: "pool", actions: [fc("unstake", { amount: "9".repeat(39) }, exitGas)] }]),
  ]);
  return stake + (exit > DEFAULT_RESERVE ? exit : DEFAULT_RESERVE);
}
export type {
  NearEpoch, NearPoolInfo, NearPoolPosition, NearStakeQuote, NearUnstakeQuote, NearClaimQuote, NearWithdrawalRequest, PoolRefusal, UnlockEstimate,
  NearStakingWarning, NearNetworkStats,
} from "@anywalletkit/protocol-staking-native-near";
export type { LiquidPoolInfo, LiquidAccountDetails, LiquidStakeQuote, LiquidUnstakeQuote, LiquidClaimQuote, LiquidWithdrawalRequest, LiquidStakingWarning } from "@anywalletkit/protocol-staking-liquid-near";

type Account = IWalletAccountReadOnly | IWalletAccount;

// one history source for the session: keyless nearblocks allows a few requests a minute
let history: ReturnType<typeof createNearHistory> | null = null;

// One instance per account object, so every component viewing the same account shares the
// module's caches (the 375 KB validators answer, block times, pool details).
const natives = new WeakMap<Account, NativeStakingProtocolNear>();
const liquids = new WeakMap<Account, Map<LiquidPresetName, LiquidStakingProtocolNear>>();

/** Native staking for `account`: any standard pool the module's allow-list accepts, mainnet. */
export function nativeStaking(account: Account, extra: Partial<NativeStakingNearConfig> = {}): NativeStakingProtocolNear {
  const shared = Object.keys(extra).length === 0;
  const hit = shared ? natives.get(account) : undefined;
  if (hit) return hit;
  history ??= createNearHistory({ network: "mainnet" });
  // history dates the last unstake, so the countdown shows the exact unlock epoch instead of a 1–4 epoch range
  const s = new NativeStakingProtocolNear(account, { pools: "any", provider: nearProviders(), discover: "fastnear", history, ...extra });
  if (shared) natives.set(account, s);
  return s;
}
export type NativeStaking = NativeStakingProtocolNear;

export type LiquidPreset = LiquidPresetName;
export const LIQUID_OPTIONS: Array<{ id: LiquidPreset; symbol: string; label: string; contract: string; note: string }> = [
  { id: "rnear", symbol: "rNEAR", label: "Rhea rNEAR", contract: LIQUID_PRESETS.rnear.contracts.mainnet!.contract, note: "Rhea's liquid staking token (5 % protocol fee)" },
  { id: "linear", symbol: "LiNEAR", label: "LiNEAR", contract: LIQUID_PRESETS.linear.contracts.mainnet!.contract, note: "LiNEAR Protocol's liquid staking token (6 % protocol fee)" },
];

/** Liquid staking through a LiNEAR-family contract (rNEAR or LiNEAR), pinned by account id and code hash. */
export function liquidStaking(account: Account, pool: LiquidPreset): LiquidStakingProtocolNear {
  let byPool = liquids.get(account);
  if (!byPool) liquids.set(account, (byPool = new Map()));
  let s = byPool.get(pool);
  if (!s) {
    // the 7-day APR reads a past price; the archival node answers browsers directly (CORS *)
    s = new LiquidStakingProtocolNear(account, { pool, provider: nearProviders(), archivalProvider: ARCHIVAL_RPC });
    byPool.set(pool, s);
  }
  return s;
}
export type LiquidStaking = LiquidStakingProtocolNear;

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
  if (e instanceof LiquidStakingError) return e.message;
  const name = (e as { name?: string })?.name ?? "";
  if (name === "ReadOnlyAccountError") return "This is a read-only demo account: connect your own wallet to sign.";
  const short = "Not enough NEAR on the account: NEAR holds back the prepaid gas when it accepts a transaction (about 0.05 NEAR per call, refunded seconds later), and a stake leaves enough to unstake later.";
  if (name === "InsufficientFundsError") return short;
  const m = e instanceof Error ? e.message : String(e);
  if (/insufficient|NotEnoughBalance/i.test(m)) return short;
  return m;
}
