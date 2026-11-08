import { describe, expect, it } from "vitest";
import dryNear from "./__fixtures__/oneclick/quote-dry-base-usdc-near.json";
import { addRecord, getFlow, loadHistory, updateFlow, type FlowRecord, type KeyValue } from "./history";
import type { QuoteResponse } from "./oneclick/types";

const kv = (): KeyValue => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe("local history", () => {
  it("keeps the whole quote, signature included, and adds tx hashes once", () => {
    const store = kv();
    const r: FlowRecord = {
      id: "f1", type: "flow", kind: "stake-in", createdAt: 1, updatedAt: 1, dry: true, account: "nima.near", target: "native:astro-stakers.poolv1.near", targetLabel: "astro",
      source: { chain: "eip155:8453", chainLabel: "Base", symbol: "USDC", decimals: 6 }, quote: dryNear.response as unknown as QuoteResponse, status: null, staked: null, txs: [],
    };
    addRecord(r, store);
    expect(getFlow("f1", store)!.quote.signature).toBe(dryNear.response.signature);
    updateFlow("f1", { status: "SUCCESS", addTx: { chain: "near:mainnet", hash: "H", label: "Delivery" } }, store);
    updateFlow("f1", { addTx: { chain: "near:mainnet", hash: "H", label: "Delivery" } }, store);
    const f = getFlow("f1", store)!;
    expect(f.status).toBe("SUCCESS");
    expect(f.txs).toHaveLength(1);
    expect(loadHistory(kv())).toEqual([]);
  });
});

describe("history cap (L14)", () => {
  it("over the cap, dry quotes go first: live signed quotes are kept for disputes", async () => {
    const { trimHistory } = await import("./history");
    const rec = (i: number, dry: boolean): FlowRecord => ({
      id: `r${i}`, type: "flow", kind: "stake-in", createdAt: i, updatedAt: i, dry, account: "a.near", target: "stnear", targetLabel: "stNEAR",
      source: { chain: "eip155:8453", chainLabel: "Base", symbol: "USDC", decimals: 6 }, quote: dryNear.response as unknown as QuoteResponse, status: null, staked: null, txs: [],
    });
    // newest first: 150 dry quotes on top of 100 live ones
    const all = [...Array.from({ length: 150 }, (_, i) => rec(1000 - i, true)), ...Array.from({ length: 100 }, (_, i) => rec(100 - i, false))];
    const kept = trimHistory(all, 200);
    expect(kept).toHaveLength(200);
    expect(kept.filter((r) => r.type === "flow" && !r.dry)).toHaveLength(100);
    // the newest dry ones stay
    expect(kept[0]!.id).toBe("r1000");
  });

  it("a paid flow keeps its paidAt across reloads, and clearing it works", () => {
    const store = kv();
    const r: FlowRecord = {
      id: "p1", type: "flow", kind: "stake-in", createdAt: 1, updatedAt: 1, dry: false, account: "a.near", target: "stnear", targetLabel: "stNEAR",
      source: { chain: "eip155:8453", chainLabel: "Base", symbol: "USDC", decimals: 6 }, quote: dryNear.response as unknown as QuoteResponse, status: null, staked: null, txs: [],
    };
    addRecord(r, store);
    updateFlow("p1", { paidAt: 42 }, store);
    expect(getFlow("p1", store)!.paidAt).toBe(42);
    updateFlow("p1", { paidAt: null }, store);
    expect(getFlow("p1", store)!.paidAt).toBeNull();
  });
});
