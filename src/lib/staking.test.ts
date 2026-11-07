// The app's staking path on the real Any Wallet Kit modules (vendor tarballs), offline: a small fake
// NEAR node answers the view calls and a fake wallet-selector wallet records what it was asked to
// sign. Proves that the wallet receives exactly the module's transactions, that the app stakes only
// what was delivered, and that the fail-closed checks reach the UI.

import { ReadOnlyAccountError } from "@anywalletkit/core";
import { LIQUID_PRESETS, LiquidStakingProtocolNear } from "@anywalletkit/protocol-staking-liquid-near";
import { KNOWN_POOL_CODE_HASHES, MIN_STAKE, NearStakingError, type NearPoolInfo } from "@anywalletkit/protocol-staking-native-near";
import { NearRpc, type NearFetch } from "@anywalletkit/wallet-near";
import { describe, expect, it, vi } from "vitest";
import { selectorAccount, watchAccount, type SelectorWalletLike } from "./near/selector-account";
import { stakeAmountAfterDelivery } from "./stakeAmount";
import { nativeStaking, poolStatus, stakingErrorText } from "./staking";

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const ME = "alice.near";
const ASTRO = "astro-stakers.poolv1.near";
const LINEAR = LIQUID_PRESETS.linear.contracts.mainnet!.contract;
const EPOCH_START = 223_300_000;

interface Delegation { staked: bigint; unstaked: bigint; canWithdraw: boolean }

function fakeNode(opts: { balance?: bigint; delegation?: Delegation } = {}) {
  const requests: Array<{ method: string; params: unknown }> = [];
  const accounts: Record<string, { amount: string; locked: string; storage_usage: number; code_hash: string }> = {
    [ME]: { amount: String(opts.balance ?? 5n * NEAR), locked: "0", storage_usage: 182, code_hash: "11111111111111111111111111111111" },
    [ASTRO]: { amount: String(10n * NEAR), locked: String(4_000_000n * NEAR), storage_usage: 300_000, code_hash: KNOWN_POOL_CODE_HASHES.mainnet[0]! },
    [LINEAR]: { amount: String(1_000_000n * NEAR), locked: "0", storage_usage: 900_000, code_hash: LIQUID_PRESETS.linear.contracts.mainnet!.codeHashes[0]! },
  };
  const d = opts.delegation ?? { staked: 0n, unstaked: 0n, canWithdraw: true };
  const views: Record<string, (args: Record<string, unknown>) => unknown> = {
    [`${ASTRO}.get_account`]: (a) => ({ account_id: a.account_id, staked_balance: String(d.staked), unstaked_balance: String(d.unstaked), can_withdraw: d.canWithdraw }),
    [`${ASTRO}.is_staking_paused`]: () => false,
    [`${ASTRO}.get_reward_fee_fraction`]: () => ({ numerator: 1, denominator: 100 }),
    [`${LINEAR}.ft_metadata`]: () => ({ symbol: "LINEAR", decimals: 24 }),
    [`${LINEAR}.get_summary`]: () => ({ ft_price: String((NEAR * 14n) / 10n), total_staked_near_amount: String(14_000_000n * NEAR), total_share_amount: String(10_000_000n * NEAR), validators_num: 200 }),
    [`${LINEAR}.ft_price`]: () => String((NEAR * 14n) / 10n),
    [`${LINEAR}.is_paused`]: () => false,
    [`${LINEAR}.get_beneficiaries`]: () => ({ "linear.sputnik-dao.near": 600 }),
  };
  const header = (height: number) => ({ header: { height, hash: `H${height}`, epoch_id: "E", timestamp_nanosec: String(1_762_000_000_000_000_000n + BigInt(height - EPOCH_START) * 575_000_000n) } });
  const fetch: NearFetch = async (method, params) => {
    requests.push({ method, params });
    const p = params as Record<string, unknown>;
    if (method === "gas_price") return { gas_price: "100000000" };
    if (method === "block") return header(typeof p.block_id === "number" ? p.block_id : EPOCH_START + 20_000);
    if (method === "validators") {
      return {
        epoch_height: 4950,
        epoch_start_height: EPOCH_START,
        current_validators: [{ account_id: ASTRO, stake: String(4_000_000n * NEAR), num_produced_blocks: 100, num_expected_blocks: 100 }],
        next_validators: [{ account_id: ASTRO, stake: String(4_000_000n * NEAR) }],
        validator_reward_paid_prev_epoch: { [ASTRO]: String(250n * NEAR) },
      };
    }
    if (method === "query" && p.request_type === "view_account") {
      const a = accounts[String(p.account_id)];
      if (!a) throw new Error(`fake node: no account ${String(p.account_id)}`);
      return { ...a, block_height: EPOCH_START + 20_000, block_hash: "H" };
    }
    if (method === "query" && p.request_type === "call_function") {
      const view = views[`${p.account_id}.${p.method_name}`];
      if (!view) return { error: `MethodNotFound ${String(p.method_name)}`, logs: [] };
      const args = JSON.parse(Buffer.from(String(p.args_base64), "base64").toString() || "{}") as Record<string, unknown>;
      return { result: [...Buffer.from(JSON.stringify(view(args)))], logs: [], block_height: EPOCH_START + 20_000 };
    }
    throw new Error(`fake node: ${method} not handled`);
  };
  return { fetch, requests };
}

const outcome = (hash: string) => ({
  status: { SuccessValue: "" },
  transaction: { hash },
  transaction_outcome: { id: hash, outcome: { status: { SuccessReceiptId: "r" }, tokens_burnt: "242" } },
  receipts_outcome: [{ id: "r", outcome: { status: { SuccessValue: "" }, tokens_burnt: "100" } }],
});

function wallet() {
  const signAndSendTransaction = vi.fn<(p: { signerId?: string; receiverId?: string; actions: unknown[] }) => Promise<unknown>>(async () => outcome("STAKE1"));
  const signAndSendTransactions = vi.fn(async (p: { transactions: unknown[] }) => p.transactions.map((_, i) => outcome(`BATCH${i}`)));
  // the shape the module builds, so the wallet's input can be compared with the quote directly
  const functionCall = (methodName: string, args: object, gas: bigint, deposit: bigint) => ({ functionCall: { methodName, args, gas, deposit } });
  return { w: { signAndSendTransaction, signAndSendTransactions } satisfies SelectorWalletLike, functionCall };
}

function setup(opts: Parameters<typeof fakeNode>[0] = {}) {
  const node = fakeNode(opts);
  const { w, functionCall } = wallet();
  const account = selectorAccount(w, ME, { rpc: new NearRpc(node.fetch), network: "mainnet", functionCall });
  // `history: undefined` keeps the test off nearblocks; `discover: false` off api.fastnear.com
  const native = nativeStaking(account, { provider: node.fetch, discover: false, history: undefined });
  return { node, w, account, native };
}

describe("staking on the real modules through the wallet-selector adapter", () => {
  it("the wallet is asked to sign exactly the module's deposit_and_stake: pool, gas, deposit", async () => {
    const { native, w } = setup();
    const q = await native.quoteStake({ amount: NEAR, pool: ASTRO });
    expect(q.transactions).toEqual([{ receiverId: ASTRO, actions: [{ functionCall: { methodName: "deposit_and_stake", args: {}, gas: 50n * TGAS, deposit: NEAR } }] }]);
    expect(q.pool.eligible).toBe(true);
    const r = await native.stake({ amount: NEAR, pool: ASTRO, expected: q.transactions });
    expect(r.hash).toBe("STAKE1");
    expect(r.fee).toBe(342n);
    expect(w.signAndSendTransaction).toHaveBeenCalledTimes(1);
    expect(w.signAndSendTransaction).toHaveBeenCalledWith({ signerId: ME, receiverId: ASTRO, actions: q.transactions[0]!.actions });
  });

  it("an account that already held 1000 NEAR stakes only the 0.73 NEAR just delivered", async () => {
    const { native } = setup({ balance: 1000n * NEAR });
    const delivered = (73n * NEAR) / 100n;
    const s = stakeAmountAfterDelivery({ reported: delivered, onChain: null, maxStakeable: await native.getMaxStakeable(), minStake: MIN_STAKE });
    expect(s).toMatchObject({ amount: delivered, capped: false, tooSmall: false });
    const q = await native.quoteStake({ amount: s.amount, pool: ASTRO });
    expect((q.transactions[0]!.actions[0] as { functionCall: { deposit: bigint } }).functionCall.deposit).toBe(delivered);
  });

  it("a fresh account is capped by what it can spend: delivery − 0.02 NEAR reserve − the fee bound", async () => {
    const { native } = setup({ balance: NEAR });
    const max = await native.getMaxStakeable();
    const { fee } = await native.quoteStake({ amount: MIN_STAKE, pool: ASTRO });
    // the fee bound is the prepaid 50 Tgas (0.005 NEAR at 10^8 yocto per gas) plus the action base fees
    expect(fee).toBeGreaterThan(5n * 10n ** 21n);
    expect(max).toBe(NEAR - 182n * 10n ** 19n - 2n * 10n ** 22n - fee);
    expect(stakeAmountAfterDelivery({ reported: NEAR, onChain: NEAR, maxStakeable: max, minStake: MIN_STAKE })).toMatchObject({ amount: max, capped: true });
  });

  it("a plan that changed since the user saw it is refused before the wallet opens", async () => {
    const { native, w } = setup();
    const q = await native.quoteStake({ amount: NEAR, pool: ASTRO });
    const err = await native.stake({ amount: 2n * NEAR, pool: ASTRO, expected: q.transactions }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NearStakingError);
    expect((err as NearStakingError).code).toBe("quote-changed");
    expect(w.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("a non-factory contract in the validator set is refused locally, with no RPC call and no wallet prompt", async () => {
    const { native, node, w } = setup();
    for (const pool of ["lst-pool.near", "meta-pool.near"]) {
      const err = await native.stake({ amount: NEAR, pool }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NearStakingError);
      expect(stakingErrorText(err)).toMatch(/not a standard staking pool/);
    }
    expect(node.requests.filter((r) => /lst-pool|meta-pool/.test(JSON.stringify(r.params)))).toEqual([]);
    expect(w.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("unstaking next to an unlocked balance withdraws it in the same transaction, one prompt", async () => {
    const { native, w } = setup({ delegation: { staked: 3n * NEAR, unstaked: 2n * NEAR, canWithdraw: true } });
    const q = await native.quoteRequestWithdrawal({ amount: NEAR, pool: ASTRO });
    expect(q.transactions[0]!.actions.map((a) => (a as { functionCall: { methodName: string } }).functionCall.methodName)).toEqual(["withdraw_all", "unstake"]);
    expect(q.withdrawsFirst).toBe(2n * NEAR);
    await native.requestWithdrawal({ amount: NEAR, pool: ASTRO, expected: q.transactions });
    expect(w.signAndSendTransaction).toHaveBeenCalledTimes(1);
    expect(w.signAndSendTransaction.mock.calls[0]![0].actions).toEqual(q.transactions[0]!.actions);
  });

  it("LiNEAR: one deposit_and_stake to the pinned contract, never a token transfer into it", async () => {
    const node = fakeNode();
    const { w, functionCall } = wallet();
    const account = selectorAccount(w, ME, { rpc: new NearRpc(node.fetch), network: "mainnet", functionCall });
    const liquid = new LiquidStakingProtocolNear(account, { pool: "linear", provider: node.fetch, apr: () => 4.6 });
    const q = await liquid.quoteStake({ amount: NEAR });
    expect(q.transactions).toEqual([{ receiverId: LINEAR, actions: [{ functionCall: { methodName: "deposit_and_stake", args: {}, gas: 100n * TGAS, deposit: NEAR } }] }]);
    expect(q.storageDeposit).toBe(0n);
    await liquid.stake({ amount: NEAR, expected: q.transactions });
    const sent = JSON.stringify(w.signAndSendTransaction.mock.calls[0]![0], (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
    expect(sent).not.toMatch(/ft_transfer/);
    expect(w.signAndSendTransaction.mock.calls[0]![0].receiverId).toBe(LINEAR);
  });

  it("a read-only demo account can't stake: the module refuses before anything is built", async () => {
    const s = nativeStaking(watchAccount("nima.near", "mainnet"), { provider: async () => ({}), discover: false });
    await expect(s.stake({ amount: NEAR, pool: ASTRO })).rejects.toBeInstanceOf(ReadOnlyAccountError);
    expect(stakingErrorText(new ReadOnlyAccountError("stake"))).toMatch(/read-only demo account/);
  });

  it("components viewing the same account share one module instance (and its caches)", () => {
    const demo = watchAccount("nima.near", "mainnet");
    expect(nativeStaking(demo)).toBe(nativeStaking(demo));
  });

  it("pool status labels follow the module's refusals", () => {
    const p = (refusals: NearPoolInfo["refusals"], extra: Partial<NearPoolInfo> = {}) => ({ refusals, details: true, eligible: refusals.length === 0, ...extra }) as NearPoolInfo;
    expect(poolStatus(p([])).label).toBe("Eligible");
    expect(poolStatus(p(["pause-unknown"])).label).toBe("Paused");
    expect(poolStatus(p(["unknown-code"])).label).toBe("Not allowed");
    expect(poolStatus(p(["fee-above-max"])).label).toBe("Fee too high");
    expect(poolStatus(p(["not-in-next-set"])).label).toBe("Leaving set");
  });
});
