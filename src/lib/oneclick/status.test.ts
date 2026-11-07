import { describe, expect, it } from "vitest";
import dryNear from "../__fixtures__/oneclick/quote-dry-base-usdc-near.json";
import failed from "../__fixtures__/oneclick/status-failed.json";
import incomplete from "../__fixtures__/oneclick/status-incomplete.json";
import known from "../__fixtures__/oneclick/status-known.json";
import pending from "../__fixtures__/oneclick/status-pending-expired.json";
import processing from "../__fixtures__/oneclick/status-processing.json";
import refunded from "../__fixtures__/oneclick/status-refunded.json";
import success from "../__fixtures__/oneclick/status-success.json";
import { simulatedStatuses } from "./simulate";
import { deliveryTxHash, depositTxHashes, fundsView, isTerminal, phaseOf, reportedDelivery, type Phase } from "./status";
import type { QuoteResponse, StatusResponse } from "./types";

const s = (f: { response: unknown }) => f.response as StatusResponse;
const deadline = Date.parse(pending.response.quoteResponse.quote.deadline); // 2026-11-05T18:48:12Z
const before = deadline - 60_000;
const after = deadline + 60_000;
const ctx = { source: "USDC on Base", destination: "astro-stakers.poolv1.near", account: "alice.near", instant: false, stake: "none" as const };

describe("phaseOf on recorded statuses", () => {
  it.each<[string, { response: unknown }, number, Phase]>([
    ["PENDING_DEPOSIT before the deadline", pending, before, "awaiting-deposit"],
    ["PENDING_DEPOSIT after the deadline (the recorded quote did expire)", pending, after, "expired"],
    ["KNOWN_DEPOSIT_TX", known, after, "deposit-detected"],
    ["INCOMPLETE_DEPOSIT before the deadline", incomplete, before, "incomplete-deposit"],
    ["INCOMPLETE_DEPOSIT after the deadline", incomplete, after, "expired"],
    ["PROCESSING", processing, after, "processing"],
    ["SUCCESS", success, after, "delivered"],
    ["REFUNDED", refunded, before, "refunded"],
    ["FAILED", failed, before, "failed"],
  ])("%s", (_, f, now, phase) => {
    expect(phaseOf(s(f), { deadlineMs: deadline, now })).toBe(phase);
  });

  it("an address 1Click doesn't know yet (404) is still awaiting the deposit", () => {
    expect(phaseOf(null, { deadlineMs: deadline, now: before })).toBe("awaiting-deposit");
  });

  it("terminal phases stop the polling", () => {
    expect(["delivered", "refunded", "failed", "expired"].every((p) => isTerminal(p as Phase))).toBe(true);
    expect(isTerminal("processing")).toBe(false);
  });
});

describe("where the funds are", () => {
  const legs = (p: Phase, stake: "none" | "ready" | "signing" | "done" = "none") => Object.fromEntries(fundsView(p, { ...ctx, stake }).legs.map((l) => [l.id, l.state]));

  it("waiting: still in the wallet", () => {
    expect(legs("awaiting-deposit")).toEqual({ source: "active", intents: "todo", near: "todo", pool: "todo" });
    expect(fundsView("awaiting-deposit", ctx).headline).toMatch(/still in your wallet/);
  });
  it("processing: held by NEAR Intents", () => {
    expect(legs("processing")).toMatchObject({ source: "done", intents: "active", near: "todo" });
    expect(fundsView("processing", ctx).headline).toMatch(/NEAR Intents holds your deposit/);
  });
  it("incomplete: waiting for a top-up, flagged", () => {
    expect(legs("incomplete-deposit").intents).toBe("waiting");
    expect(fundsView("incomplete-deposit", ctx).tone).toBe("warn");
  });
  it("delivered: on the NEAR account until the stake is signed, then in the pool", () => {
    expect(legs("delivered")).toMatchObject({ intents: "done", near: "active", pool: "todo" });
    expect(legs("delivered", "done")).toMatchObject({ near: "done", pool: "done" });
    expect(fundsView("delivered", { ...ctx, stake: "done" }).headline).toMatch(/staked in astro-stakers/);
  });
  it("Instant stNEAR has no stake leg", () => {
    expect(fundsView("delivered", { ...ctx, instant: true }).legs.map((l) => l.id)).toEqual(["source", "intents", "near"]);
  });
  it.each<Phase>(["refunded", "failed", "expired"])("%s is shown as a failure, with the refund in the headline", (p) => {
    const v = fundsView(p, ctx);
    expect(v.tone).toBe("bad");
    expect(v.legs.find((l) => l.id === "intents")!.state).toBe("failed");
    expect(v.headline).toMatch(/refund/i);
  });
});

describe("reading the delivery", () => {
  it("amountOut and the NEAR transaction only after SUCCESS", () => {
    expect(reportedDelivery(s(success))).toBe(755320382313437861848237n);
    expect(deliveryTxHash(s(success))).toBe("AQAkvxyT2N2WzZ5LzwZvcw139WHG2JGAvVLqBdVYUttX");
    expect(reportedDelivery(s(processing))).toBeNull();
    expect(depositTxHashes(s(known))).toHaveLength(1);
  });
});

describe("dry-run replay", () => {
  const q = dryNear.response as unknown as QuoteResponse;
  it("success ends in SUCCESS with the quoted amount; expired never leaves PENDING_DEPOSIT", () => {
    const ok = simulatedStatuses(q, "success");
    expect(ok.map((x) => x.status)).toEqual(["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"]);
    expect(reportedDelivery(ok.at(-1)!)).toBe(BigInt(q.quote.amountOut));
    expect(simulatedStatuses(q, "expired").map((x) => x.status)).toEqual(["PENDING_DEPOSIT"]);
    expect(simulatedStatuses(q, "refunded").at(-1)!.status).toBe("REFUNDED");
    expect(simulatedStatuses(q, "incomplete").at(-1)!.status).toBe("INCOMPLETE_DEPOSIT");
  });
});
