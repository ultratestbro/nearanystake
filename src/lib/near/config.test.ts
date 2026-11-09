// nearProviders() outside the browser: the proxy's three nodes, and a pause before going round again.

import { NearRpcError, type NearFetch } from "@anywalletkit/wallet-near";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_RPC, PUBLIC_RPC, nearProviders } from "./config";

const ok = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result: { gas_price: "100000000" } }));
const limited = () => new Response("Too Many Requests", { status: 429 });
const unknownAccount = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } }));

let hosts: string[] = [];
function nodes(answer: (n: number) => Response) {
  hosts = [];
  vi.stubGlobal("fetch", async (url: string) => answer(hosts.push(new URL(url).host)));
}
const client = () => nearProviders()[0] as NearFetch;
const round = [new URL(PUBLIC_RPC).host, "rpc.mainnet.fastnear.com", new URL(FALLBACK_RPC).host];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("nearProviders on the server", () => {
  it("fails over between both FastNEAR nodes and dRPC, then pauses and goes round again", async () => {
    nodes((n) => (n <= 6 ? limited() : ok()));
    const out = client()("gas_price", [null]);
    await vi.advanceTimersByTimeAsync(0);
    expect(hosts).toEqual([...round, ...round]); // wallet-near's own failover: the list plus 3 retries
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await out).toEqual({ gas_price: "100000000" });
    expect(hosts).toHaveLength(7);
  });

  it("a node's own answer is final: no failover, no pause", async () => {
    nodes(unknownAccount);
    await expect(client()("query", { request_type: "view_account", finality: "final", account_id: "nobody.near" })).rejects.toBeInstanceOf(NearRpcError);
    expect(hosts).toHaveLength(1);
  });

  it("gives up after three rounds", async () => {
    nodes(limited);
    const out = client()("gas_price", [null]);
    const failed = expect(out).rejects.toThrow("All NEAR providers failed for gas_price");
    await vi.advanceTimersByTimeAsync(3_000);
    await failed;
    expect(hosts).toHaveLength(18);
  });
});
