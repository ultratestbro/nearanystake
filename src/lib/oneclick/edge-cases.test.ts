// Regression tests for the edge cases of a 1Click flow: deadlines, the quote echo, statuses and resumes.
import { describe, expect, it } from "vitest";
import dryNear from "../__fixtures__/oneclick/quote-dry-base-usdc-near.json";
import dryOut from "../__fixtures__/oneclick/quote-dry-near-to-base-usdc.json";
import pending from "../__fixtures__/oneclick/status-pending-expired.json";
import success from "../__fixtures__/oneclick/status-success.json";
import { ONE_CLICK_FEE_RECIPIENT, SLOW_DEADLINE_MS, addressInactiveAt, buildInboundQuoteRequest, deadlineMsFor, payCutoffMs, quoteDeadline, verifyQuoteEcho } from "./quote";
import { fundsView, isFinal, isTerminal, phaseOf } from "./status";
import type { QuoteRequest, QuoteResponse, StatusResponse } from "./types";

const asRes = (r: unknown) => structuredClone(r) as QuoteResponse;
const live = asRes(pending.response.quoteResponse);
const liveReq = live.quoteRequest as unknown as QuoteRequest;

describe("deadlines", () => {
  it("the countdown ends when the refund begins (request deadline), not when the address goes inactive (+72 h)", () => {
    const refundAt = Date.parse(String(live.quoteRequest.deadline));
    expect(quoteDeadline(live)).toBe(refundAt);
    expect(addressInactiveAt(live)! - refundAt).toBe(72 * 3_600_000);
    // whichever is earlier wins
    const odd = asRes(live);
    odd.quote.deadline = new Date(refundAt - 60_000).toISOString();
    expect(quoteDeadline(odd)).toBe(refundAt - 60_000);
  });

  it("an hour past the request deadline the swap is expired, although the address is still active", () => {
    const st = { ...pending.response, status: "PENDING_DEPOSIT" } as unknown as StatusResponse;
    const refundAt = quoteDeadline(live)!;
    expect(phaseOf(st, { deadlineMs: refundAt, now: refundAt + 3_600_000 })).toBe("expired");
  });

  it("slow UTXO chains get 3 h and stop offering payment 90 min before; others 1 h and 5 min", () => {
    for (const c of ["bitcoin:mainnet", "zcash:mainnet", "litecoin:mainnet", "doge:mainnet", "bch:mainnet"]) {
      expect(deadlineMsFor(c)).toBe(SLOW_DEADLINE_MS);
      expect(payCutoffMs(c)).toBe(90 * 60_000);
    }
    expect(deadlineMsFor("eip155:8453")).toBe(3_600_000);
    expect(payCutoffMs("eip155:8453")).toBe(5 * 60_000);
    const now = Date.parse("2026-11-08T00:00:00.000Z");
    const r = buildInboundQuoteRequest({ target: "near", originAsset: "nep141:btc.omft.near", amount: 10_000n, recipient: "alice.near", refundTo: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", dry: true, now, deadlineMs: deadlineMsFor("bitcoin:mainnet") });
    expect(r.deadline).toBe("2026-11-08T03:00:00.000Z");
  });
});

describe("quote echo gaps", () => {
  const dry = () => asRes(dryNear.response);
  const req = dryNear.request as unknown as QuoteRequest;

  it("app fees: only 1Click's recipient, at most 20 bps", () => {
    expect(verifyQuoteEcho(req, dry())).toEqual({ ok: true });
    const other = dry();
    other.quoteRequest.appFees = [{ recipient: ONE_CLICK_FEE_RECIPIENT, fee: 20 }, { recipient: "relay.near", fee: 10 }];
    expect(verifyQuoteEcho(req, other)).toEqual({ ok: false, mismatches: ["appFees"] });
    const swapped = dry();
    swapped.quoteRequest.appFees = [{ recipient: "relay.near", fee: 20 }];
    expect(verifyQuoteEcho(req, swapped)).toEqual({ ok: false, mismatches: ["appFees"] });
    const stable = dry();
    stable.quoteRequest.appFees = [{ recipient: ONE_CLICK_FEE_RECIPIENT, fee: 1 }];
    expect(verifyQuoteEcho(req, stable)).toEqual({ ok: true });
    const garbage = dry();
    (garbage.quoteRequest as Record<string, unknown>).appFees = "20";
    expect(verifyQuoteEcho(req, garbage)).toEqual({ ok: false, mismatches: ["appFees"] });
  });

  it("a missing echoed deadline is refused", () => {
    const r = dry();
    delete (r.quoteRequest as Record<string, unknown>).deadline;
    expect(verifyQuoteEcho(req, r)).toEqual({ ok: false, mismatches: ["deadline"] });
  });

  it("minAmountOut must honour the slippage the user accepted (and never exceed amountOut)", () => {
    const low = dry();
    low.quote.minAmountOut = ((BigInt(low.quote.amountOut) * 9800n) / 10_000n).toString(); // 2 % below, 1 % accepted
    expect(verifyQuoteEcho(req, low)).toEqual({ ok: false, mismatches: ["quote.minAmountOut"] });
    const high = dry();
    high.quote.minAmountOut = (BigInt(high.quote.amountOut) + 1n).toString();
    expect(verifyQuoteEcho(req, high)).toEqual({ ok: false, mismatches: ["quote.minAmountOut"] });
  });

  it("a live deposit address must be an address of the origin chain; outbound, a NEAR implicit account", () => {
    expect(verifyQuoteEcho(liveReq, asRes(live))).toEqual({ ok: true });
    expect(verifyQuoteEcho(liveReq, asRes(live), { depositAddressValid: (a) => /^0x[0-9a-fA-F]{40}$/.test(a) })).toEqual({ ok: true });
    expect(verifyQuoteEcho(liveReq, asRes(live), { depositAddressValid: () => false })).toEqual({ ok: false, mismatches: ["depositAddress"] });
    const outReq = { ...(dryOut.request as unknown as QuoteRequest), dry: false };
    const out = asRes(dryOut.response);
    out.quoteRequest.dry = false;
    out.quote.depositAddress = "bob.near";
    expect(verifyQuoteEcho(outReq, out)).toEqual({ ok: false, mismatches: ["depositAddress"] });
    out.quote.depositAddress = "a".repeat(64);
    expect(verifyQuoteEcho(outReq, out)).toEqual({ ok: true });
  });
});

describe("statuses on resume", () => {
  const s = (f: { response: unknown }) => f.response as StatusResponse;
  const ctx = { source: "USDC on Base", destination: "astro-stakers.poolv1.near", account: "alice.near", instant: false, stake: "none" as const };

  it("a flow reopened from History is 'unknown' (never payable) until 1Click answers, even past the deadline", () => {
    const deadline = quoteDeadline(live)!;
    expect(phaseOf(null, { deadlineMs: deadline, now: deadline + 1, resumed: true })).toBe("unknown");
    expect(phaseOf(null, { deadlineMs: deadline, now: deadline - 1, resumed: true })).toBe("unknown");
    expect(phaseOf(s(success), { deadlineMs: deadline, now: deadline + 1, resumed: true })).toBe("delivered");
    expect(fundsView("unknown", ctx).headline).toMatch(/Don't pay again/);
  });

  it("a status this app does not know is 'unknown', not payable", () => {
    const st = { ...s(pending), status: "AWAITING_SOMETHING_NEW" } as unknown as StatusResponse;
    expect(phaseOf(st, { deadlineMs: null, now: 0 })).toBe("unknown");
  });

  it("only 1Click's own answers are final: past our deadline the page keeps checking", () => {
    expect(isTerminal("expired")).toBe(true);
    expect(isFinal("expired")).toBe(false);
    expect(["delivered", "refunded", "failed"].every((p) => isFinal(p as never))).toBe(true);
    expect(isFinal("unknown")).toBe(false);
  });

  it("FAILED copy promises no automatic refund", () => {
    const v = fundsView("failed", ctx);
    expect(v.headline).not.toMatch(/refunds the deposit/);
    expect(v.headline).toMatch(/support/);
  });
});
