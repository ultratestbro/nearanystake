import { describe, expect, it } from "vitest";
import dryNear from "../__fixtures__/oneclick/quote-dry-base-usdc-near.json";
import dryOut from "../__fixtures__/oneclick/quote-dry-near-to-base-usdc.json";
import dryStnear from "../__fixtures__/oneclick/quote-dry-sol-stnear.json";
import pending from "../__fixtures__/oneclick/status-pending-expired.json";
import {
  MAX_APP_FEE_BPS, NEAR_ASSET, STNEAR_ASSET, UnsafeQuoteError, assertSafeQuoteRequest, buildInboundQuoteRequest, buildOutboundQuoteRequest, verifyQuoteEcho,
} from "./quote";
import type { QuoteRequest, QuoteResponse } from "./types";

const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const asReq = (r: unknown) => r as QuoteRequest;
const asRes = (r: unknown) => structuredClone(r) as QuoteResponse;

describe("buildInboundQuoteRequest", () => {
  const base = { originAsset: BASE_USDC, amount: 3_000_000n, recipient: "alice.near", refundTo: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", dry: true, now: Date.parse("2026-11-08T00:00:00.400Z") };

  it("delivers native NEAR on the destination chain to the given account", () => {
    const r = buildInboundQuoteRequest({ ...base, target: "near" });
    expect(r).toMatchObject({ destinationAsset: NEAR_ASSET, recipientType: "DESTINATION_CHAIN", depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", swapType: "EXACT_INPUT", amount: "3000000", dry: true });
    // deadline in whole seconds, one hour out
    expect(r.deadline).toBe("2026-11-08T01:00:00.000Z");
  });

  it("Instant stNEAR is the only other destination", () => {
    expect(buildInboundQuoteRequest({ ...base, target: "stnear" }).destinationAsset).toBe(STNEAR_ASSET);
  });

  it("never sets customRecipientMsg", () => {
    for (const target of ["near", "stnear"] as const) expect("customRecipientMsg" in buildInboundQuoteRequest({ ...base, target })).toBe(false);
  });

  it("refuses a recipient that is not a NEAR account id", () => {
    expect(() => buildInboundQuoteRequest({ ...base, target: "near", recipient: "Bad_Account!!" })).toThrow(UnsafeQuoteError);
  });
});

describe("assertSafeQuoteRequest", () => {
  const ok = asReq(dryNear.request);

  it("accepts the recorded request", () => {
    expect(() => assertSafeQuoteRequest(ok, "inbound")).not.toThrow();
  });

  it.each([
    ["customRecipientMsg (ft_transfer_call into a token without ft_on_transfer)", { customRecipientMsg: "" }],
    ["an LST as the destination", { destinationAsset: "nep141:linear-protocol.near" }],
    ["rNEAR as the destination", { destinationAsset: "nep141:lst.rhealab.near" }],
    ["delivery into an intents balance", { recipientType: "INTENTS" }],
    ["refunds inside intents", { refundType: "INTENTS" }],
    ["a missing dry flag", { dry: undefined }],
    ["a zero amount", { amount: "0" }],
    ["EXACT_OUTPUT", { swapType: "EXACT_OUTPUT" }],
  ])("refuses %s", (_, patch) => {
    expect(() => assertSafeQuoteRequest({ ...ok, ...patch } as QuoteRequest, "inbound")).toThrow(UnsafeQuoteError);
  });

  it("outbound: starts from NEAR, refunds to the NEAR account, never into a liquid staking token", () => {
    const out = buildOutboundQuoteRequest({ destinationAsset: BASE_USDC, amount: 2n * 10n ** 24n, recipient: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", refundTo: "alice.near", dry: true });
    expect(out.originAsset).toBe(NEAR_ASSET);
    expect(() => buildOutboundQuoteRequest({ destinationAsset: STNEAR_ASSET, amount: 1n, recipient: "x", refundTo: "alice.near", dry: true })).toThrow(UnsafeQuoteError);
    expect(() => buildOutboundQuoteRequest({ destinationAsset: BASE_USDC, amount: 1n, recipient: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", refundTo: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", dry: true })).toThrow(UnsafeQuoteError);
  });
});

describe("verifyQuoteEcho on recorded 1Click answers", () => {
  it("accepts the recorded dry quotes (NEAR, stNEAR, and NEAR → Base USDC)", () => {
    for (const f of [dryNear, dryStnear, dryOut]) expect(verifyQuoteEcho(asReq(f.request), asRes(f.response))).toEqual({ ok: true });
  });

  it("accepts the recorded live quote (deposit address present, deadline normalised to the second)", () => {
    const res = asRes(pending.response.quoteResponse);
    const approved = { ...(res.quoteRequest as QuoteRequest), recipientType: "INTENTS" } as unknown as QuoteRequest;
    expect(verifyQuoteEcho(approved, res)).toEqual({ ok: true });
  });

  it.each([
    ["recipient", { recipient: "mallory.near" }],
    ["refundTo", { refundTo: "0x000000000000000000000000000000000000beef" }],
    ["destinationAsset", { destinationAsset: STNEAR_ASSET }],
    ["originAsset", { originAsset: "nep141:sol.omft.near" }],
    ["amount", { amount: "3000001" }],
    ["recipientType", { recipientType: "INTENTS" }],
    ["dry", { dry: false }],
    ["deadline", { deadline: "2030-01-01T00:00:00.000Z" }],
  ])("refuses a response whose echoed %s differs", (field, patch) => {
    const res = asRes(dryNear.response);
    Object.assign(res.quoteRequest, patch);
    const v = verifyQuoteEcho(asReq(dryNear.request), res);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.mismatches).toContain(field);
  });

  it("compares EVM addresses without regard to case, nothing else", () => {
    const res = asRes(dryNear.response);
    res.quoteRequest.refundTo = String(res.quoteRequest.refundTo).toLowerCase();
    expect(verifyQuoteEcho(asReq(dryNear.request), res).ok).toBe(true);
  });

  it("refuses customRecipientMsg in the echo or the quote", () => {
    const a = asRes(dryNear.response);
    a.quoteRequest.customRecipientMsg = "{}";
    expect(verifyQuoteEcho(asReq(dryNear.request), a).ok).toBe(false);
    const b = asRes(dryNear.response);
    b.quote.customRecipientMsg = "";
    expect(verifyQuoteEcho(asReq(dryNear.request), b).ok).toBe(false);
  });

  it(`refuses app fees above ${MAX_APP_FEE_BPS} bps (the recorded 20 bps passes)`, () => {
    const res = asRes(dryNear.response);
    res.quoteRequest.appFees = [...(res.quoteRequest.appFees ?? []), { recipient: "mallory.near", fee: 500 }];
    expect(verifyQuoteEcho(asReq(dryNear.request), res)).toEqual({ ok: false, mismatches: ["appFees"] });
  });

  it("refuses a deposit address on a dry quote, and a live quote without one", () => {
    const dry = asRes(dryNear.response);
    dry.quote.depositAddress = "0x62F099A5C804f165351eE84CA41239b4283fAe1a";
    expect(verifyQuoteEcho(asReq(dryNear.request), dry)).toEqual({ ok: false, mismatches: ["depositAddress"] });
    const live = asRes(pending.response.quoteResponse);
    delete live.quote.depositAddress;
    expect(verifyQuoteEcho({ ...(live.quoteRequest as QuoteRequest) }, live).ok).toBe(false);
  });

  it("refuses a missing signature (it is what settles disputes) and a quoted amountIn that differs", () => {
    const a = asRes(dryNear.response);
    a.signature = "";
    expect(verifyQuoteEcho(asReq(dryNear.request), a)).toEqual({ ok: false, mismatches: ["signature"] });
    const b = asRes(dryNear.response);
    b.quote.amountIn = "1";
    expect(verifyQuoteEcho(asReq(dryNear.request), b)).toEqual({ ok: false, mismatches: ["quote.amountIn"] });
  });

  it("refuses an empty answer", () => {
    expect(verifyQuoteEcho(asReq(dryNear.request), null).ok).toBe(false);
  });
});
