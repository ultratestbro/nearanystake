// Talks to 1Click straight from the browser: it answers with `access-control-allow-origin: *` and
// needs no key, so no server of ours sits between the user and the quote they approve.

import { assertSafeQuoteRequest, verifyQuoteEcho } from "./quote";
import type { OneClickToken, QuoteRequest, QuoteResponse, StatusResponse } from "./types";

export const ONE_CLICK_API = process.env.NEXT_PUBLIC_ONE_CLICK_API_URL || "https://1click.chaindefuser.com/v0";

type Fetch = typeof fetch;

/** A live (non-dry) request while dry-run mode is on. Thrown before anything leaves the browser. */
export class DryRunGuardError extends Error {
  constructor() {
    super("Dry-run mode is on: only dry quotes can be requested.");
    this.name = "DryRunGuardError";
  }
}

export class OneClickError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OneClickError";
    this.status = status;
  }
}

export class QuoteEchoError extends Error {
  readonly mismatches: string[];
  constructor(mismatches: string[]) {
    super(`The quote does not match what you approved (${mismatches.join(", ")}). Nothing was sent.`);
    this.name = "QuoteEchoError";
    this.mismatches = mismatches;
  }
}

export interface QuoteMode {
  /** The app-wide dry-run switch. */
  dryRun: boolean;
  direction: "inbound" | "outbound";
  /** Checks a live quote's deposit address is an address of the origin chain (inbound). */
  depositAddressValid?: (address: string) => boolean;
  fetchImpl?: Fetch;
  signal?: AbortSignal;
}

/**
 * POSTs a quote request and returns the response only if it echoes the approved request exactly.
 * In dry-run mode a request with `dry: false` never leaves the browser.
 */
export async function requestQuote(req: QuoteRequest, mode: QuoteMode): Promise<QuoteResponse> {
  if (mode.dryRun && req.dry !== true) throw new DryRunGuardError();
  assertSafeQuoteRequest(req, mode.direction);
  const f = mode.fetchImpl ?? fetch;
  const res = await f(`${ONE_CLICK_API}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    ...(mode.signal ? { signal: mode.signal } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as QuoteResponse & { message?: string };
  if (!res.ok) throw new OneClickError(friendlyQuoteError(body.message ?? "", res.status), res.status);
  const echo = verifyQuoteEcho(req, body, mode.depositAddressValid ? { depositAddressValid: mode.depositAddressValid } : {});
  if (!echo.ok) throw new QuoteEchoError(echo.mismatches);
  return body;
}

/** 1Click's refusals in words a user can act on. */
export function friendlyQuoteError(message: string, status: number): string {
  if (/minimum swap amount is \$(\d+)/i.test(message)) return `This route has a temporary minimum of $${/\$(\d+)/.exec(message)![1]}. Try a larger amount.`;
  if (/recipient is not valid/i.test(message)) return "That NEAR account id isn't valid.";
  if (/refundTo is not valid/i.test(message)) return "1Click doesn't accept that refund address for this network.";
  if (/amount is too low|too small|no liquidity|insufficient/i.test(message)) return "No route for this amount. Try a larger one.";
  if (status >= 500 || status === 0) return "NEAR Intents is not answering right now. Try again in a minute.";
  if (/internal server error/i.test(message)) return "1Click refused the quote. A named NEAR account must exist before it can receive.";
  return message || `1Click answered ${status}.`;
}

export async function getStatus(depositAddress: string, depositMemo?: string | null, fetchImpl: Fetch = fetch): Promise<StatusResponse | null> {
  const q = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) });
  const res = await fetchImpl(`${ONE_CLICK_API}/status?${q}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new OneClickError(`Status ${res.status}`, res.status);
  return (await res.json()) as StatusResponse;
}

/** Tells 1Click the deposit tx so it doesn't wait for its own indexer (speeds things up, optional). */
export async function submitDepositTx(p: { txHash: string; depositAddress: string; memo?: string | null; nearSenderAccount?: string }, fetchImpl: Fetch = fetch): Promise<void> {
  await fetchImpl(`${ONE_CLICK_API}/deposit/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txHash: p.txHash, depositAddress: p.depositAddress, ...(p.memo ? { memo: p.memo } : {}), ...(p.nearSenderAccount ? { nearSenderAccount: p.nearSenderAccount } : {}) }),
  }).catch(() => {});
}

let tokens: Promise<OneClickToken[]> | null = null;
export function listTokens(fetchImpl: Fetch = fetch): Promise<OneClickToken[]> {
  tokens ??= fetchImpl(`${ONE_CLICK_API}/tokens`).then((r) => r.json() as Promise<OneClickToken[]>);
  tokens.catch(() => (tokens = null));
  return tokens;
}
