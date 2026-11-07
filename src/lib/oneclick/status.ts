// 1Click status → what the user sees: one phase, and where the money is right now on its way
// source chain → NEAR Intents → the NEAR account → the staking pool.

import type { OneClickStatus, StatusResponse } from "./types";

export type Phase =
  | "awaiting-deposit"   // PENDING_DEPOSIT before the deadline
  | "deposit-detected"   // KNOWN_DEPOSIT_TX: the tx is seen, waiting for confirmations
  | "incomplete-deposit" // INCOMPLETE_DEPOSIT: less than quoted arrived (often an exchange's fee)
  | "processing"         // PROCESSING: swapping and delivering
  | "delivered"          // SUCCESS: native NEAR (or stNEAR) is on the NEAR account
  | "refunded"           // REFUNDED
  | "failed"             // FAILED: 1Click refunds
  | "expired";           // the deadline passed with no (or not enough) deposit: anything sent is refunded

export const TERMINAL_PHASES: ReadonlySet<Phase> = new Set(["delivered", "refunded", "failed", "expired"]);

export const isTerminal = (p: Phase) => TERMINAL_PHASES.has(p);

const BY_STATUS: Record<OneClickStatus, Phase> = {
  PENDING_DEPOSIT: "awaiting-deposit",
  KNOWN_DEPOSIT_TX: "deposit-detected",
  INCOMPLETE_DEPOSIT: "incomplete-deposit",
  PROCESSING: "processing",
  SUCCESS: "delivered",
  REFUNDED: "refunded",
  FAILED: "failed",
};

/**
 * The phase of a swap. `status` null means 1Click does not know the deposit address yet (it
 * answers 404 for a moment after the quote). Past the deadline, a swap still waiting for (enough)
 * deposit is expired: the address goes cold and late deposits are refunded.
 */
export function phaseOf(status: StatusResponse | null, ctx: { deadlineMs: number | null; now: number }): Phase {
  const p = status ? BY_STATUS[status.status] : "awaiting-deposit";
  if (!p) return "awaiting-deposit";
  const late = ctx.deadlineMs !== null && ctx.now > ctx.deadlineMs;
  if (late && (p === "awaiting-deposit" || p === "incomplete-deposit")) return "expired";
  return p;
}

export type LegState = "done" | "active" | "todo" | "failed" | "waiting";

export interface Leg {
  id: "source" | "intents" | "near" | "pool";
  label: string;
  hint: string;
  state: LegState;
}

export interface FundsView {
  /** One sentence: where the money is now. */
  headline: string;
  tone: "neutral" | "good" | "warn" | "bad";
  legs: Leg[];
}

export interface FundsContext {
  /** "USDC on Base". */
  source: string;
  /** "astro-stakers.poolv1.near", "rNEAR", "stNEAR". */
  destination: string;
  /** The NEAR account receiving. */
  account: string;
  /** Instant stNEAR: the token lands on the account, there is no stake step. */
  instant: boolean;
  /** Stake step after delivery. */
  stake: "none" | "ready" | "signing" | "done" | "failed";
  dry?: boolean;
}

/** The route strip and the "where are my funds" sentence for a phase. */
export function fundsView(phase: Phase, c: FundsContext): FundsView {
  const deposited = phase !== "awaiting-deposit" && phase !== "expired";
  const atIntents = phase === "processing" || phase === "incomplete-deposit";
  const delivered = phase === "delivered";
  const refunding = phase === "refunded" || phase === "failed" || phase === "expired";
  const staked = c.instant ? delivered : c.stake === "done";

  const legs: Leg[] = [
    {
      id: "source",
      label: `${c.source}`,
      hint: phase === "awaiting-deposit" ? (c.dry ? "dry run: nothing to send" : "waiting for your deposit") : phase === "refunded" ? "refunded here" : "sent",
      state: phase === "awaiting-deposit" ? "active" : phase === "expired" ? "failed" : phase === "refunded" ? "done" : "done",
    },
    {
      id: "intents",
      label: "NEAR Intents",
      hint:
        phase === "deposit-detected" ? "deposit seen, confirming" : phase === "incomplete-deposit" ? "less than quoted arrived" : phase === "processing" ? "swapping into NEAR" : phase === "failed" ? "failed: refund under way" : "",
      state: refunding ? (deposited || phase === "expired" ? "failed" : "todo") : delivered ? "done" : phase === "incomplete-deposit" ? "waiting" : atIntents || phase === "deposit-detected" ? "active" : "todo",
    },
    {
      id: "near",
      label: c.instant ? `stNEAR on ${c.account}` : `NEAR on ${c.account}`,
      hint: delivered && !c.instant && c.stake !== "done" ? "delivered, ready to stake" : "",
      state: delivered ? (c.instant || c.stake === "done" ? "done" : "active") : "todo",
    },
  ];
  if (!c.instant) legs.push({ id: "pool", label: c.destination, hint: c.stake === "signing" ? "waiting for your signature" : c.stake === "failed" ? "not staked yet: your NEAR is safe on your account" : "", state: staked ? "done" : c.stake === "failed" ? "failed" : delivered && c.stake === "signing" ? "active" : "todo" });

  let headline: string;
  let tone: FundsView["tone"] = "neutral";
  switch (phase) {
    case "awaiting-deposit":
      headline = c.dry ? `Dry run: your funds would still be in your wallet (${c.source}).` : `Your funds are still in your wallet. Send the deposit to start.`;
      break;
    case "deposit-detected":
      headline = `Your deposit is on ${c.source.split(" on ").pop()}, waiting for confirmations before NEAR Intents takes it.`;
      break;
    case "incomplete-deposit":
      headline = "Less than the quoted amount arrived (an exchange may have taken its fee). Top up the difference before the deadline, or it is refunded.";
      tone = "warn";
      break;
    case "processing":
      headline = "NEAR Intents holds your deposit and is swapping it into NEAR for your account.";
      break;
    case "delivered":
      headline = c.instant
        ? `Done: stNEAR is on ${c.account}.`
        : staked
          ? `Done: your NEAR is staked in ${c.destination}.`
          : `Your NEAR is on ${c.account}. One signature stakes it.`;
      tone = "good";
      break;
    case "refunded":
      headline = `Refunded to your wallet on ${c.source.split(" on ").pop()} (minus the refund fee).`;
      tone = "bad";
      break;
    case "failed":
      headline = "The swap failed. 1Click refunds the deposit to your refund address.";
      tone = "bad";
      break;
    case "expired":
      headline = "The quote expired before a full deposit arrived. Anything sent to the address is refunded.";
      tone = "bad";
      break;
  }
  return { headline, tone, legs };
}

/** NEAR (or stNEAR) 1Click reports as delivered, base units; null before SUCCESS. */
export function reportedDelivery(status: StatusResponse | null): bigint | null {
  if (status?.status !== "SUCCESS") return null;
  const out = status.swapDetails?.amountOut;
  return out && /^\d+$/.test(out) ? BigInt(out) : null;
}

/** The NEAR-side delivery transaction, when 1Click lists one. */
export function deliveryTxHash(status: StatusResponse | null): string | null {
  return status?.swapDetails?.destinationChainTxHashes?.[0]?.hash ?? null;
}

/** Source-chain deposit transactions 1Click saw. */
export function depositTxHashes(status: StatusResponse | null): string[] {
  return (status?.swapDetails?.originChainTxHashes ?? []).map((t) => t.hash);
}
