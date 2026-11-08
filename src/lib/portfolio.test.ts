import { describe, expect, it } from "vitest";
import dryNear from "./__fixtures__/oneclick/quote-dry-base-usdc-near.json";
import dryOut from "./__fixtures__/oneclick/quote-dry-near-to-base-usdc.json";
import pending from "./__fixtures__/oneclick/status-pending-expired.json";
import type { ActionRecord, FlowRecord } from "./history";
import type { QuoteResponse } from "./oneclick/types";
import {
  activityStatus, activitySubtitle, activityTitle, compactNear, heroAmount, initials, poolName, stepText, summarize, trimDecimal, usdText, yearlyReward,
} from "./portfolio";

const NEAR = 10n ** 24n;
const near = (s: string) => {
  const [w, f = ""] = s.split(".");
  return BigInt(w!) * NEAR + BigInt((f + "0".repeat(24)).slice(0, 24));
};

const live = pending.response.quoteResponse as unknown as QuoteResponse;
const flow = (over: Partial<FlowRecord> = {}): FlowRecord => ({
  id: "f", type: "flow", kind: "stake-in", createdAt: 1, updatedAt: 1, dry: false, account: "allintse.near", target: "native:astro-stakers.poolv1.near",
  targetLabel: "astro-stakers.poolv1.near", source: { chain: "eip155:8453", chainLabel: "Base", symbol: "USDC", decimals: 6 }, quote: live, status: null, staked: null, txs: [],
  ...over,
});

describe("portfolio figures", () => {
  it("names and discs for pools", () => {
    expect(poolName("astro-stakers.poolv1.near")).toBe("astro-stakers");
    expect(poolName("aurora.pool.near")).toBe("aurora");
    expect(initials("astro-stakers")).toBe("AS");
    expect(initials("figment")).toBe("FI");
    expect(compactNear(near("33145426"))).toBe("33.1 M NEAR");
    expect(compactNear(near("4200.7"))).toBe("4.2 k NEAR");
    expect(compactNear(0n)).toBe("0 NEAR");
  });

  it("yearly reward stays bigint and matches the brief's example", () => {
    // 1.29 NEAR at 5.02 % ≈ 0.065 NEAR
    expect(yearlyReward(near("1.29"), 5.02)).toBe((near("1.29") * 502n) / 10_000n);
    expect(yearlyReward(near("1"), null)).toBeNull();
    expect(yearlyReward(near("1"), Number.NaN)).toBeNull();
    // far above 2^53 yocto: no precision lost
    expect(yearlyReward(near("1000000"), 5)).toBe(near("50000"));
  });

  it("sums staked, unstaking and ready; the APR is stake-weighted and says when part is unknown", () => {
    const s = summarize([
      { staked: near("0.4259"), unstaking: 0n, ready: 0n, apr: 5.02 },
      { staked: near("1"), unstaking: near("2"), ready: near("0.5"), apr: 4 },
    ]);
    expect(s.staked).toBe(near("1.4259"));
    expect(s.unstaking).toBe(near("2"));
    expect(s.ready).toBe(near("0.5"));
    expect(s.yearly).toBe(yearlyReward(near("0.4259"), 5.02)! + yearlyReward(near("1"), 4)!);
    expect(s.apr).toBeGreaterThan(4);
    expect(s.apr).toBeLessThan(5.02);
    expect(s.aprPartial).toBe(false);
    const p = summarize([{ staked: near("1"), unstaking: 0n, ready: 0n, apr: null }]);
    expect(p.yearly).toBeNull();
    expect(p.apr).toBeNull();
    expect(p.aprPartial).toBe(true);
    expect(summarize([]).yearly).toBeNull();
  });

  it("formats for the hero and USD", () => {
    expect(heroAmount(near("0.4259"))).toBe("0.4259");
    expect(heroAmount(near("12345.6789"))).toBe("12,345.67");
    expect(usdText(near("0.4259"), 3.72)).toBe("≈ $1.58");
    expect(usdText(near("0.001"), 3.72)).toBe("< $0.01");
    expect(usdText(near("1"), null)).toBeNull();
    expect(trimDecimal("7.268337123", 6)).toBe("7.268337");
    expect(trimDecimal("2.000", 6)).toBe("2");
  });
});

describe("recent activity in plain words", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");

  it("human statuses, never the raw 1Click word", () => {
    expect(activityStatus(flow({ dry: true, quote: dryNear.response as unknown as QuoteResponse }), now)).toEqual({ label: "Dry run", tone: "neutral" });
    expect(activityStatus(flow({ status: "SUCCESS", staked: near("0.4259").toString() }), now).label).toBe("Done");
    expect(activityStatus(flow({ status: "SUCCESS" }), now)).toEqual({ label: "Needs your signature", tone: "attention" });
    expect(activityStatus(flow({ kind: "instant-stnear", status: "SUCCESS" }), now).label).toBe("Done");
    expect(activityStatus(flow({ status: "PROCESSING" }), now)).toEqual({ label: "In progress", tone: "progress" });
    expect(activityStatus(flow({ status: "REFUNDED" }), now)).toEqual({ label: "Refunded", tone: "danger" });
    expect(activityStatus(flow({ status: "FAILED" }), now).tone).toBe("danger");
    expect(activityStatus(flow({ status: "INCOMPLETE_DEPOSIT" }), now).label).toBe("Less than quoted");
    // paid from a wallet, 1Click not caught up yet
    expect(activityStatus(flow({ status: "PENDING_DEPOSIT", paidAt: 5 }), now).label).toBe("In progress");
    // the fixture's deadline (2026-11-02) has passed and nothing was paid
    expect(activityStatus(flow(), now)).toEqual({ label: "Not paid", tone: "neutral" });
    expect(activityStatus(flow(), Date.parse("2026-11-01T00:00:00Z")).label).toBe("Waiting for payment");
    const action: ActionRecord = { id: "a", type: "action", kind: "unstake", createdAt: 1, account: "allintse.near", target: "astro-stakers.poolv1.near", amount: near("1").toString(), txs: [] };
    expect(activityStatus(action, now).label).toBe("Done");
  });

  it("titles, subtitles and steps", () => {
    const done = flow({
      status: "SUCCESS",
      staked: near("0.4259").toString(),
      txs: [
        { chain: "eip155:8453", hash: "0x588a", label: "Deposit" },
        { chain: "near:mainnet", hash: "vZw1", label: "Delivery" },
        { chain: "near:mainnet", hash: "UpiN", label: "Stake" },
      ],
    });
    expect(activityTitle(done)).toBe("Staked 0.4259 NEAR into astro-stakers");
    expect(activitySubtitle(done)).toBe("1.000469 USDC on Base → ≈ 0.25501 NEAR");
    expect(done.txs.map((t) => stepText(done, t))).toEqual([
      { text: "Paid 1.000469 USDC", where: "on Base" },
      { text: "NEAR arrived", where: "on allintse.near, via NEAR Intents" },
      { text: "0.4259 NEAR staked", where: "into astro-stakers" },
    ]);
    expect(activityTitle(flow({ targetLabel: "rNEAR" }))).toBe("Stake into rNEAR");

    const out = flow({
      kind: "withdraw-out", dry: true, quote: dryOut.response as unknown as QuoteResponse, target: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", targetLabel: "USDC on Base",
      source: { chain: "near:mainnet", chainLabel: "NEAR", symbol: "NEAR", decimals: 24 },
    });
    expect(activityTitle(out)).toBe("Dry-run quote: cash out to USDC on Base");
    expect(activitySubtitle(out)).toBe("2 NEAR from allintse.near → ≈ 7.268337 USDC on Base");
    expect(activityTitle({ ...out, dry: false, status: "SUCCESS" })).toBe("Cashed out 2 NEAR to USDC on Base");

    const claim: ActionRecord = { id: "c", type: "action", kind: "claim", createdAt: 1, account: "nima.near", target: "a.poolv1.near, b.pool.near", amount: near("168.9").toString(), txs: [{ chain: "near:mainnet", hash: "h", label: "Withdraw" }] };
    expect(activityTitle(claim)).toBe("Withdrew 168.9 NEAR from a, b");
    expect(stepText(claim, claim.txs[0]!)).toEqual({ text: "Withdrawal sent", where: "from a, b" });
  });
});
