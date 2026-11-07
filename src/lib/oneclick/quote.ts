// Builds the 1Click quote requests this app sends and checks what comes back.
//
// Two rules hold for every request (critique #5, #10):
//  - the NEAR side is always the connected account: inbound it is the recipient, outbound the refund
//    address. There is no field where someone types a NEAR recipient.
//  - `customRecipientMsg` is never set. With it 1Click delivers through ft_transfer_call, and none of
//    the NEAR liquid staking tokens implements ft_on_transfer: the funds would be lost.

import { isValidAccountId } from "@anywalletkit/wallet-near";
import type { EchoedQuoteRequest, QuoteRequest, QuoteResponse } from "./types";

/** 1Click turns wNEAR into native NEAR on DESTINATION_CHAIN delivery (mainnet tx AQAkvxyT…, Oct 2026). */
export const NEAR_ASSET = "nep141:wrap.near";
/** Meta Pool stNEAR: the only token delivered straight to the account (Instant stNEAR). */
export const STNEAR_ASSET = "nep141:meta-pool.near";

/** NEAR tokens that must never be the target of a 1Click delivery with a message, or a withdrawal destination. */
export const LIQUID_STAKING_TOKENS = ["meta-pool.near", "linear-protocol.near", "lst.rhealab.near"] as const;

export const DEFAULT_SLIPPAGE_BPS = 100;
export const DEFAULT_DEADLINE_MS = 60 * 60_000;
/** 1Click's own fee without a partner key is 20 bps; anything far above it means the quote was not ours. */
export const MAX_APP_FEE_BPS = 30;

export type InboundTarget = "near" | "stnear";

const deadlineIso = (now = Date.now()) => new Date(Math.floor((now + DEFAULT_DEADLINE_MS) / 1000) * 1000).toISOString();

export class UnsafeQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeQuoteError";
  }
}

const isEvm = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
const isPositiveInt = (s: string) => /^[1-9]\d*$/.test(s);

export interface InboundQuoteInput {
  target: InboundTarget;
  originAsset: string;
  /** Origin-asset base units to send. */
  amount: bigint;
  /** The connected NEAR account (in dry mode without a wallet: the demo account). */
  recipient: string;
  /** The user's own wallet on the source chain: refunds go there. */
  refundTo: string;
  dry: boolean;
  slippageBps?: number;
  now?: number;
}

/** Any chain → native NEAR (or stNEAR) on the user's NEAR account. */
export function buildInboundQuoteRequest(i: InboundQuoteInput): QuoteRequest {
  const req: QuoteRequest = {
    dry: i.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: i.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    originAsset: i.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: i.target === "stnear" ? STNEAR_ASSET : NEAR_ASSET,
    amount: i.amount.toString(),
    refundTo: i.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: i.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: deadlineIso(i.now),
  };
  assertSafeQuoteRequest(req, "inbound");
  return req;
}

export interface OutboundQuoteInput {
  /** 1Click asset id on the destination chain (never a NEAR token). */
  destinationAsset: string;
  /** yoctoNEAR to send. */
  amount: bigint;
  /** The user's own address on the destination chain. */
  recipient: string;
  /** The connected NEAR account: a failed swap refunds there. */
  refundTo: string;
  dry: boolean;
  slippageBps?: number;
  now?: number;
}

/** NEAR → any chain ("Withdraw to any chain" after an unstake). */
export function buildOutboundQuoteRequest(o: OutboundQuoteInput): QuoteRequest {
  const req: QuoteRequest = {
    dry: o.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: o.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    originAsset: NEAR_ASSET,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: o.destinationAsset,
    amount: o.amount.toString(),
    refundTo: o.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: o.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: deadlineIso(o.now),
  };
  assertSafeQuoteRequest(req, "outbound");
  return req;
}

/** Throws when a request breaks the app's rules. Runs before every POST, whoever built the request. */
export function assertSafeQuoteRequest(req: QuoteRequest, direction: "inbound" | "outbound"): void {
  const r = req as QuoteRequest & Record<string, unknown>;
  if ("customRecipientMsg" in r) throw new UnsafeQuoteError("customRecipientMsg is never sent: liquid staking tokens have no ft_on_transfer.");
  if (typeof r.dry !== "boolean") throw new UnsafeQuoteError("dry must be set explicitly.");
  if (r.swapType !== "EXACT_INPUT") throw new UnsafeQuoteError("Only EXACT_INPUT quotes are used.");
  if (r.depositType !== "ORIGIN_CHAIN" || r.refundType !== "ORIGIN_CHAIN" || r.recipientType !== "DESTINATION_CHAIN") {
    throw new UnsafeQuoteError("Deposits, refunds and deliveries must all be on-chain (ORIGIN_CHAIN / DESTINATION_CHAIN).");
  }
  if (!isPositiveInt(r.amount)) throw new UnsafeQuoteError("amount must be a positive integer in base units.");
  if (!Number.isInteger(r.slippageTolerance) || r.slippageTolerance < 1 || r.slippageTolerance > 500) throw new UnsafeQuoteError("slippage must be 1–500 bps.");
  if (Number.isNaN(Date.parse(r.deadline))) throw new UnsafeQuoteError("deadline must be an ISO time.");
  if (direction === "inbound") {
    if (r.destinationAsset !== NEAR_ASSET && r.destinationAsset !== STNEAR_ASSET) throw new UnsafeQuoteError("Inbound quotes deliver native NEAR or stNEAR only.");
    if (!isValidAccountId(r.recipient)) throw new UnsafeQuoteError("The recipient must be a NEAR account id.");
    if (!r.refundTo) throw new UnsafeQuoteError("A refund address on the source chain is required.");
  } else {
    if (r.originAsset !== NEAR_ASSET) throw new UnsafeQuoteError("Outbound quotes start from NEAR.");
    const dest = r.destinationAsset.replace(/^nep141:/, "");
    if (dest === "wrap.near" || (LIQUID_STAKING_TOKENS as readonly string[]).includes(dest)) throw new UnsafeQuoteError("Withdrawals leave NEAR: pick a token on another chain.");
    if (!isValidAccountId(r.refundTo)) throw new UnsafeQuoteError("Refunds of a NEAR withdrawal go to the NEAR account.");
    if (!r.recipient) throw new UnsafeQuoteError("A recipient on the destination chain is required.");
  }
}

/** The fields compared between what the user approved and what 1Click echoed. */
export const ECHO_FIELDS = [
  "dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType",
] as const;

export type EchoResult = { ok: true } | { ok: false; mismatches: string[] };

const sameValue = (a: unknown, b: unknown) =>
  a === b || (typeof a === "string" && typeof b === "string" && isEvm(a) && isEvm(b) && a.toLowerCase() === b.toLowerCase());

/**
 * Compares a quote response with the request the user approved. Any difference (a relay or a
 * compromised server changing the recipient, the refund address, the asset or the amount) refuses the
 * quote. Also refuses a message-carrying delivery, an unexpected app fee, a deposit address on a dry
 * quote and a missing signature.
 */
export function verifyQuoteEcho(approved: QuoteRequest, res: QuoteResponse | null | undefined): EchoResult {
  const m: string[] = [];
  const echo: EchoedQuoteRequest | undefined = res?.quoteRequest;
  if (!res || !echo || !res.quote) return { ok: false, mismatches: ["quoteRequest"] };
  for (const f of ECHO_FIELDS) if (!sameValue(echo[f], approved[f])) m.push(f);
  // the deadline is sent in whole seconds; allow 1 s of rounding in the echo
  if (echo.deadline !== undefined && !(Math.abs(Date.parse(String(echo.deadline)) - Date.parse(approved.deadline)) <= 1000)) m.push("deadline");
  if (echo.customRecipientMsg !== undefined && echo.customRecipientMsg !== null) m.push("customRecipientMsg");
  if (res.quote.customRecipientMsg !== undefined && res.quote.customRecipientMsg !== null) m.push("quote.customRecipientMsg");
  const feeBps = (echo.appFees ?? []).reduce((s, f) => s + (Number.isFinite(f.fee) ? f.fee : Infinity), 0);
  if (feeBps > MAX_APP_FEE_BPS) m.push("appFees");
  if (approved.dry && res.quote.depositAddress) m.push("depositAddress");
  if (!approved.dry && !res.quote.depositAddress) m.push("depositAddress");
  if (res.quote.amountIn !== approved.amount) m.push("quote.amountIn");
  if (!isPositiveInt(String(res.quote.amountOut)) || !/^\d+$/.test(String(res.quote.minAmountOut))) m.push("quote.amountOut");
  if (typeof res.signature !== "string" || res.signature.length < 16) m.push("signature");
  return m.length ? { ok: false, mismatches: m } : { ok: true };
}

/** Deadline of a live quote (dry quotes have none: they can't be paid). */
export function quoteDeadline(res: QuoteResponse): number | null {
  const t = res.quote.deadline ? Date.parse(res.quote.deadline) : NaN;
  return Number.isNaN(t) ? null : t;
}
