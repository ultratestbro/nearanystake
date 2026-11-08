// What the Portfolio page says about the numbers and records it shows: totals, the yearly estimate,
// short pool names, and plain-words activity rows. Pure functions, amounts stay bigint.

import { bigintToNumber } from "@anywalletkit/core";
import type { FlowRecord, HistoryRecord, TxRef } from "./history";
import { quoteDeadline } from "./oneclick/quote";
import { formatNear, formatUnits, money } from "./format";

const YOCTO = 10n ** 24n;

/** "astro-stakers.poolv1.near" → "astro-stakers". */
export const poolName = (id: string) => id.replace(/\.(poolv1|pool)\.near$/, "");

/** Two letters for a pool's disc: "astro-stakers" → "AS", "figment" → "FI". */
export function initials(name: string): string {
  const words = name.split(/[-_.\s]+/).filter(Boolean);
  const s = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : name.slice(0, 2);
  return s.toUpperCase();
}

/** A pool's total stake, rounded for a glance: "33.1 M NEAR". */
export function compactNear(yocto: bigint): string {
  const n = bigintToNumber(yocto / YOCTO);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M NEAR`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k NEAR`;
  return `${n} NEAR`;
}

/** NEAR as a float, for a USD estimate only (never for amounts that get signed). */
export function nearFloat(yocto: bigint): number {
  return Number(formatUnits(yocto, 24, 8).replace(/,/g, ""));
}

/** "≈ $1.58"; "< $0.01" for dust; null without a price. */
export function usdText(yocto: bigint, price: number | null | undefined): string | null {
  if (!price || !Number.isFinite(price)) return null;
  const v = nearFloat(yocto) * price;
  if (v > 0 && v < 0.01) return "< $0.01";
  return `≈ ${money(v)}`;
}

/** Fewer decimals as the number grows, so the hero figure fits a phone. */
export function heroAmount(yocto: bigint): string {
  return formatUnits(yocto, 24, yocto >= 1000n * YOCTO ? 2 : 4);
}

/** Small figures keep enough digits to say something: 0.0214, 0.00031. */
export function smallNear(yocto: bigint): string {
  return formatNear(yocto, yocto < YOCTO / 100n ? 5 : yocto < YOCTO ? 4 : 3);
}

/** amount × APR (percent, kept to 1/100 of a percent), in bigint. Null when the APR is unknown. */
export function yearlyReward(amount: bigint, aprPercent: number | null | undefined): bigint | null {
  if (aprPercent === null || aprPercent === undefined || !Number.isFinite(aprPercent) || aprPercent < 0) return null;
  return (amount * BigInt(Math.round(aprPercent * 100))) / 10_000n;
}

/** One position as the totals need it. `staked` earns; `unstaking` waits for its epoch; `ready` can be withdrawn. */
export interface Holding {
  staked: bigint;
  unstaking: bigint;
  ready: bigint;
  /** Percent; null when unknown. */
  apr: number | null;
}

export interface Summary {
  staked: bigint;
  unstaking: bigint;
  ready: bigint;
  /** Sum of staked × APR where the APR is known; null when none is. */
  yearly: bigint | null;
  /** The stake-weighted APR behind `yearly`. */
  apr: number | null;
  /** Some stake has no APR yet, so `yearly` leaves it out. */
  aprPartial: boolean;
}

export function summarize(hs: Holding[]): Summary {
  let staked = 0n;
  let unstaking = 0n;
  let ready = 0n;
  let yearly: bigint | null = null;
  let withApr = 0n;
  let aprPartial = false;
  for (const h of hs) {
    staked += h.staked;
    unstaking += h.unstaking;
    ready += h.ready;
    const y = h.staked > 0n ? yearlyReward(h.staked, h.apr) : null;
    if (y !== null) {
      yearly = (yearly ?? 0n) + y;
      withApr += h.staked;
    } else if (h.staked > 0n) aprPartial = true;
  }
  // basis points of a small ratio: far below 2^53
  const apr = yearly !== null && withApr > 0n ? bigintToNumber((yearly * 10_000n) / withApr) / 100 : null;
  return { staked, unstaking, ready, yearly, apr, aprPartial };
}

// ---- Recent activity ----

export type ActivityTone = "success" | "progress" | "attention" | "danger" | "neutral";

const short = (target: string) =>
  target
    .split(", ")
    .map((t) => poolName(t.replace(/^native:/, "")))
    .join(", ");

const isNearOut = (r: FlowRecord) => r.quote.quoteRequest.destinationAsset === "nep141:wrap.near";

/** "2 USDC" (inbound) or "0.5 NEAR" (outbound): what the user paid. */
function paid(r: FlowRecord): string {
  return `${formatUnits(BigInt(r.quote.quote.amountIn), r.source.decimals)} ${r.source.symbol}`;
}

/** What the quote delivers: "≈ 0.53743 NEAR", "≈ 1.29 USDC on Base". */
function received(r: FlowRecord): string {
  if (r.kind === "withdraw-out") return `≈ ${trimDecimal(r.quote.quote.amountOutFormatted, 6)} ${r.targetLabel}`;
  return `≈ ${formatUnits(BigInt(r.quote.quote.amountOut), 24, 5)} ${r.kind === "instant-stnear" ? "stNEAR" : isNearOut(r) ? "NEAR" : ""}`.trim();
}

/** "1.234567891" → "1.234567" (string-only, no float rounding). */
export function trimDecimal(s: string, maxFrac: number): string {
  const [w, f = ""] = s.split(".");
  const frac = f.slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${w}.${frac}` : (w ?? s);
}

/** The state of a record in a few words, for the badge. */
export function activityStatus(r: HistoryRecord, now: number): { label: string; tone: ActivityTone } {
  if (r.type === "action") return { label: "Done", tone: "success" };
  if (r.dry) return { label: "Dry run", tone: "neutral" };
  switch (r.status) {
    case "SUCCESS":
      if (r.kind !== "stake-in" || r.staked) return { label: "Done", tone: "success" };
      // a stake was signed and its result never confirmed: it may have landed, so check before signing again
      return r.stakeAttemptAt ? { label: "Check your stake", tone: "attention" } : { label: "Needs your signature", tone: "attention" };
    case "REFUNDED":
      return { label: "Refunded", tone: "danger" };
    case "FAILED":
      return { label: "Failed", tone: "danger" };
    case "INCOMPLETE_DEPOSIT":
      return { label: "Less than quoted", tone: "attention" };
    case "KNOWN_DEPOSIT_TX":
    case "PROCESSING":
      return { label: "In progress", tone: "progress" };
    default: {
      if (r.paidAt || r.txs.length > 0) return { label: "In progress", tone: "progress" };
      const deadline = quoteDeadline(r.quote);
      if (deadline !== null && now > deadline) return { label: "Not paid", tone: "neutral" };
      return { label: "Waiting for payment", tone: "attention" };
    }
  }
}

/** The row's headline: what happened, or what this was for. */
export function activityTitle(r: HistoryRecord): string {
  if (r.type === "action") {
    const amount = formatNear(BigInt(r.amount));
    if (r.kind === "unstake") return `Unstaked ${amount} from ${short(r.target)}`;
    if (r.kind === "claim") return `Withdrew ${amount} from ${short(r.target)}`;
    return `Staked ${amount} into ${short(r.target)}`;
  }
  const to = short(r.targetLabel);
  if (r.kind === "withdraw-out") {
    if (r.dry) return `Dry-run quote: cash out to ${r.targetLabel}`;
    return r.status === "SUCCESS" ? `Cashed out ${paid(r)} to ${r.targetLabel}` : `Cash out to ${r.targetLabel}`;
  }
  if (r.kind === "instant-stnear") {
    if (r.dry) return "Dry-run quote: instant stNEAR";
    return r.status === "SUCCESS" ? `Got ${received(r)}` : "Instant stNEAR";
  }
  if (r.dry) return `Dry-run quote: stake into ${to}`;
  if (r.staked) return `Staked ${formatNear(BigInt(r.staked))} into ${to}`;
  return `Stake into ${to}`;
}

/** The row's second line: the swap in short. */
export function activitySubtitle(r: HistoryRecord): string {
  if (r.type === "action") return `on ${r.account}`;
  const from = r.kind === "withdraw-out" ? `${paid(r)} from ${r.account}` : `${paid(r)} on ${r.source.chainLabel}`;
  return `${from} → ${received(r)}`;
}

/** One transaction of a record as a step: what it did, and where (muted). */
export function stepText(r: HistoryRecord, t: TxRef): { text: string; where: string } {
  const label = t.label.toLowerCase();
  if (r.type === "flow") {
    if (label === "deposit")
      return r.kind === "withdraw-out" ? { text: `Sent ${paid(r)}`, where: `from ${r.account}` } : { text: `Paid ${paid(r)}`, where: `on ${r.source.chainLabel}` };
    if (label === "delivery") return { text: r.kind === "instant-stnear" ? "stNEAR arrived" : "NEAR arrived", where: `on ${r.account}, via NEAR Intents` };
    if (label === "stake") return { text: r.staked ? `${formatNear(BigInt(r.staked))} staked` : "Staked", where: `into ${short(r.targetLabel)}` };
  }
  if (label === "unstake") return { text: "Unstake sent", where: r.type === "action" ? `from ${short(r.target)}` : "" };
  if (label === "withdraw" || label === "claim") return { text: "Withdrawal sent", where: r.type === "action" ? `from ${short(r.target)}` : "" };
  return { text: t.label, where: "" };
}
