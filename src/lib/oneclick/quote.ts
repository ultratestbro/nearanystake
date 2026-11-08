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
/**
 * 1Click's own fee without a partner key: 20 bps (1 bp on stablecoin routes) to this one recipient, in
 * every quote recorded since October 2026. A different recipient or a higher total means someone else
 * added a fee (a relay, a changed API URL): refused.
 */
export const ONE_CLICK_FEE_RECIPIENT = "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd";
export const MAX_APP_FEE_BPS = 20;

/**
 * Chains whose deposits confirm slowly: 1Click's docs say Bitcoin may take about an hour. A 1-hour
 * deadline there refunds deposits that were sent in time, so these quotes get 3 hours.
 */
export const SLOW_CHAINS: ReadonlySet<string> = new Set(["bitcoin:mainnet", "zcash:mainnet", "litecoin:mainnet", "doge:mainnet", "bch:mainnet"]);
export const SLOW_DEADLINE_MS = 3 * 60 * 60_000;

/** The deadline a quote for deposits on `chain` asks for. */
export const deadlineMsFor = (chain: string): number => (SLOW_CHAINS.has(chain) ? SLOW_DEADLINE_MS : DEFAULT_DEADLINE_MS);

/**
 * How long before the deadline paying stops being offered: a deposit must be seen by 1Click before
 * the refund begins, and a slow chain needs its confirmations too.
 */
export const payCutoffMs = (chain: string): number => (SLOW_CHAINS.has(chain) ? 90 * 60_000 : 5 * 60_000);

export type InboundTarget = "near" | "stnear";

const deadlineIso = (now = Date.now(), ms = DEFAULT_DEADLINE_MS) => new Date(Math.floor((now + ms) / 1000) * 1000).toISOString();

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
  /** Time until the refund begins; default 1 h (`deadlineMsFor(chain)` gives slow chains 3 h). */
  deadlineMs?: number;
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
    deadline: deadlineIso(i.now, i.deadlineMs),
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

/** NEAR → any chain ("Cash out to any chain" after an unstake). */
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

/** A NEAR implicit account (64 hex): what 1Click deposit addresses on NEAR are. */
const isNearImplicit = (a: string) => /^[0-9a-f]{64}$/.test(a);

/**
 * Compares a quote response with the request the user approved. Any difference (a relay or a
 * compromised server changing the recipient, the refund address, the asset or the amount) refuses the
 * quote. Also refuses a message-carrying delivery, a fee to anyone but 1Click or above its own, a
 * missing deadline, a minimum below the slippage the user accepted, a deposit address on a dry quote or
 * one that is not an address of the origin chain, and a missing signature. The signature itself is
 * not verified: 1Click publishes no key for it, so it is kept for disputes only.
 */
export function verifyQuoteEcho(
  approved: QuoteRequest,
  res: QuoteResponse | null | undefined,
  o: { depositAddressValid?: (address: string) => boolean } = {},
): EchoResult {
  const m: string[] = [];
  const echo: EchoedQuoteRequest | undefined = res?.quoteRequest;
  if (!res || !echo || !res.quote) return { ok: false, mismatches: ["quoteRequest"] };
  for (const f of ECHO_FIELDS) if (!sameValue(echo[f], approved[f])) m.push(f);
  // the deadline is sent in whole seconds; allow 1 s of rounding in the echo
  if (echo.deadline === undefined || !(Math.abs(Date.parse(String(echo.deadline)) - Date.parse(approved.deadline)) <= 1000)) m.push("deadline");
  if (echo.customRecipientMsg !== undefined && echo.customRecipientMsg !== null) m.push("customRecipientMsg");
  if (res.quote.customRecipientMsg !== undefined && res.quote.customRecipientMsg !== null) m.push("quote.customRecipientMsg");
  const fees = Array.isArray(echo.appFees) ? echo.appFees : echo.appFees === undefined ? [] : null;
  const feeBps = fees ? fees.reduce((s, f) => s + (Number.isInteger(f?.fee) && f.fee >= 0 ? f.fee : Infinity), 0) : Infinity;
  if (!fees || feeBps > MAX_APP_FEE_BPS || fees.some((f) => f.fee > 0 && f.recipient !== ONE_CLICK_FEE_RECIPIENT)) m.push("appFees");
  const address = res.quote.depositAddress;
  if (approved.dry && address) m.push("depositAddress");
  if (!approved.dry) {
    const valid = typeof address === "string" && address.length > 0 && (approved.originAsset === NEAR_ASSET ? isNearImplicit(address) : (o.depositAddressValid?.(address) ?? true));
    if (!valid) m.push("depositAddress");
  }
  if (res.quote.amountIn !== approved.amount) m.push("quote.amountIn");
  const out = String(res.quote.amountOut), min = String(res.quote.minAmountOut);
  if (!isPositiveInt(out) || !/^\d+$/.test(min)) m.push("quote.amountOut");
  // the guaranteed minimum is what the user agreed to: never below amountOut − slippage, never above amountOut
  else if (BigInt(min) < (BigInt(out) * BigInt(10_000 - approved.slippageTolerance)) / 10_000n || BigInt(min) > BigInt(out)) m.push("quote.minAmountOut");
  if (typeof res.signature !== "string" || res.signature.length < 16) m.push("signature");
  return m.length ? { ok: false, mismatches: m } : { ok: true };
}

/**
 * When paying stops making sense: the request's deadline (the refund begins then), or the quote's
 * `deadline` if that is earlier (the deposit address becomes inactive then; 1Click answers +72 h).
 * Dry quotes have none: they can't be paid.
 */
export function quoteDeadline(res: QuoteResponse): number | null {
  const parse = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
  const times = [parse(res.quoteRequest?.deadline), parse(res.quote.deadline)].filter((t) => !Number.isNaN(t));
  return times.length ? Math.min(...times) : null;
}

/** When the deposit address becomes inactive (`quote.deadline`); a deposit after it may be lost. */
export function addressInactiveAt(res: QuoteResponse): number | null {
  const t = res.quote.deadline ? Date.parse(res.quote.deadline) : NaN;
  return Number.isNaN(t) ? null : t;
}
