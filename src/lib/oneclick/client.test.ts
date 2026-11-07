import { describe, expect, it, vi } from "vitest";
import dryNear from "../__fixtures__/oneclick/quote-dry-base-usdc-near.json";
import tronMin from "../__fixtures__/oneclick/quote-error-tron-min.json";
import { DryRunGuardError, OneClickError, QuoteEchoError, requestQuote } from "./client";
import { UnsafeQuoteError } from "./quote";
import type { QuoteRequest } from "./types";

const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const req = dryNear.request as QuoteRequest;

describe("requestQuote", () => {
  it("dry-run guard: a live request never leaves the browser while dry-run mode is on", async () => {
    const f = respond(201, dryNear.response);
    await expect(requestQuote({ ...req, dry: false }, { dryRun: true, direction: "inbound", fetchImpl: f as unknown as typeof fetch })).rejects.toBeInstanceOf(DryRunGuardError);
    expect(f).not.toHaveBeenCalled();
  });

  it("dry-run mode still requests dry quotes", async () => {
    const f = respond(201, dryNear.response);
    const res = await requestQuote(req, { dryRun: true, direction: "inbound", fetchImpl: f as unknown as typeof fetch });
    expect(res.signature).toMatch(/^ed25519:/);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).dry).toBe(true);
  });

  it("refuses an unsafe request before sending it", async () => {
    const f = respond(201, dryNear.response);
    await expect(requestQuote({ ...req, customRecipientMsg: "" } as QuoteRequest, { dryRun: true, direction: "inbound", fetchImpl: f as unknown as typeof fetch })).rejects.toBeInstanceOf(UnsafeQuoteError);
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses a response that echoes another recipient (a tampering relay)", async () => {
    const tampered = structuredClone(dryNear.response);
    tampered.quoteRequest.recipient = "mallory.near";
    const f = respond(201, tampered);
    const p = requestQuote(req, { dryRun: true, direction: "inbound", fetchImpl: f as unknown as typeof fetch });
    await expect(p).rejects.toBeInstanceOf(QuoteEchoError);
    await expect(p).rejects.toMatchObject({ mismatches: ["recipient"] });
  });

  it("turns 1Click's refusals into sentences (recorded Tron $100 minimum)", async () => {
    const f = respond(400, tronMin.response);
    const p = requestQuote(tronMin.request as QuoteRequest, { dryRun: true, direction: "inbound", fetchImpl: f as unknown as typeof fetch });
    await expect(p).rejects.toBeInstanceOf(OneClickError);
    await expect(p).rejects.toThrow(/temporary minimum of \$100/);
  });
});
