// A tiny NEAR node for tests: validators, view_account, view calls on pools, gas price, blocks.
import { NearRpcError, type NearFetch } from "@anywalletkit/wallet-near";

export interface FakePool {
  codeHash?: string;
  paused?: boolean | "missing" | "throws";
  fee?: { numerator: number; denominator: number } | "missing";
  accounts?: Record<string, { staked: bigint; unstaked: bigint; canWithdraw: boolean }>;
}

export interface FakeChain {
  current: Array<{ id: string; stake: bigint }>;
  next: Array<{ id: string; stake: bigint }>;
  rewards?: Record<string, bigint>;
  pools: Record<string, FakePool>;
  balances?: Record<string, bigint>;
}

const J1 = "J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY";

export function fakeNear(chain: FakeChain) {
  const calls: Array<{ method: string; account?: string; fn?: string }> = [];
  const bytes = (v: unknown) => ({ result: Array.from(new TextEncoder().encode(JSON.stringify(v))) });
  const fetch: NearFetch = async (method, params) => {
    const p = params as Record<string, unknown>;
    calls.push({ method, account: p?.account_id as string | undefined, fn: p?.method_name as string | undefined });
    if (method === "validators")
      return {
        epoch_height: 4946,
        epoch_start_height: 223_500_000,
        current_validators: chain.current.map((v) => ({ account_id: v.id, stake: v.stake.toString(), num_produced_blocks: 100, num_expected_blocks: 100 })),
        next_validators: chain.next.map((v) => ({ account_id: v.id, stake: v.stake.toString() })),
        validator_reward_paid_prev_epoch: Object.fromEntries(Object.entries(chain.rewards ?? {}).map(([k, v]) => [k, v.toString()])),
      };
    if (method === "gas_price") return { gas_price: "100000000" };
    if (method === "block") {
      const h = (p as { block_id?: number }).block_id ?? 223_520_000;
      return { header: { height: h, timestamp_nanosec: String(BigInt(h) * 575_000_000n) } };
    }
    if (method === "query" && p.request_type === "view_account") {
      const id = p.account_id as string;
      const pool = chain.pools[id];
      if (!pool && chain.balances?.[id] === undefined) throw new NearRpcError("query", { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } });
      return { amount: String(chain.balances?.[id] ?? 10n ** 27n), locked: "0", storage_usage: 500, code_hash: pool?.codeHash ?? (pool ? J1 : "11111111111111111111111111111111") };
    }
    if (method === "query" && p.request_type === "call_function") {
      const pool = chain.pools[p.account_id as string];
      if (!pool) throw new NearRpcError("query", { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } });
      const args = JSON.parse(atob(p.args_base64 as string)) as { account_id?: string };
      switch (p.method_name) {
        case "is_staking_paused":
          if (pool.paused === "missing") throw new NearRpcError("query", { name: "HANDLER_ERROR", message: "MethodResolveError(MethodNotFound)" });
          if (pool.paused === "throws") throw new Error("socket hang up");
          return bytes(pool.paused ?? false);
        case "get_reward_fee_fraction":
          if (pool.fee === "missing") throw new NearRpcError("query", { name: "HANDLER_ERROR", message: "MethodResolveError(MethodNotFound)" });
          return bytes(pool.fee ?? { numerator: 1, denominator: 100 });
        case "get_account": {
          const a = pool.accounts?.[args.account_id ?? ""];
          return bytes({ account_id: args.account_id, staked_balance: String(a?.staked ?? 0n), unstaked_balance: String(a?.unstaked ?? 0n), can_withdraw: a?.canWithdraw ?? true });
        }
      }
      throw new NearRpcError("query", { name: "HANDLER_ERROR", message: "MethodResolveError(MethodNotFound)" });
    }
    throw new Error(`fake node: ${method}`);
  };
  return { fetch, calls };
}
