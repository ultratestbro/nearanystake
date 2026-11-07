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
