// The app shows pools and plans stakes through the module API; until the SDK methods land, the preview
// backend answers reads with the same allow-list rules (NEAR-STAKING-API §2.3). These tests pin how the
// app uses that allow-list: a lying RPC alone never makes a pool stakeable.
import { describe, expect, it } from "vitest";
import { watchAccount } from "../near/selector-account";
import { fakeNear, type FakeChain } from "./fakeNear";
import { PreviewNativeStaking, PreviewWriteError } from "./preview";

const M = 10n ** 30n; // 1M NEAR
const chain = (pools: FakeChain["pools"], extra: Partial<FakeChain> = {}): FakeChain => {
  const ids = Object.keys(pools).filter((id) => id !== "lst-pool.near" || extra.current);
  return { current: ids.map((id) => ({ id, stake: 10n * M })), next: ids.map((id) => ({ id, stake: 10n * M })), rewards: Object.fromEntries(ids.map((id) => [id, 10n ** 27n])), pools, ...extra };
};
const staking = (c: FakeChain, maxFee?: number) => {
  const node = fakeNear(c);
  return { s: new PreviewNativeStaking(watchAccount("alice.near", "mainnet"), { pools: "any", provider: node.fetch, discover: false, ...(maxFee ? { maxFee } : {}) }), node };
};

describe("pool allow-list as the app uses it", () => {
  it("a standard pool with known code, not paused, 1 % fee, in both sets is eligible", async () => {
    const { s } = staking(chain({ "astro-stakers.poolv1.near": {} }));
    const p = await s.getPool("astro-stakers.poolv1.near");
    expect(p).toMatchObject({ eligible: true, refusals: [], feePercent: 1, paused: false, codeHashKnown: true });
  });

  it("lst-pool.near (in the validator set, own code) is refused locally, with no RPC call about it", async () => {
    const { s, node } = staking(chain({ "lst-pool.near": { codeHash: "DqKkcbjBiPJju2tqis8G7ayfBePvq9Gn8mjvykNupYxx", paused: "missing" } }, { current: [{ id: "lst-pool.near", stake: M }], next: [{ id: "lst-pool.near", stake: M }] }));
    const p = await s.getPool("lst-pool.near");
    expect(p.eligible).toBe(false);
    expect(p.refusals).toEqual(["not-factory-pool"]);
    expect(node.calls.filter((c) => c.account === "lst-pool.near")).toHaveLength(0);
  });

  it("meta-pool.near is refused the same way (whitelisted for lockups, but not a staking pool)", async () => {
    const { s } = staking(chain({}));
    expect((await s.getPool("meta-pool.near")).refusals).toContain("not-factory-pool");
  });

  describe("a lying RPC: each lie alone refuses", () => {
    it("unknown code hash behind a factory-looking id", async () => {
      const { s } = staking(chain({ "evil.poolv1.near": { codeHash: "EviLEviLEviLEviLEviLEviLEviLEviLEviLEviLEviL", fee: { numerator: 1, denominator: 100 } } }));
      const p = await s.getPool("evil.poolv1.near");
      expect(p.eligible).toBe(false);
      expect(p.refusals).toContain("unknown-code");
    });
    it("pause method missing", async () => {
      const { s } = staking(chain({ "evil.poolv1.near": { paused: "missing" } }));
      expect((await s.getPool("evil.poolv1.near")).refusals).toEqual(["pause-unknown"]);
    });
    it("pause read throwing", async () => {
      const { s } = staking(chain({ "evil.poolv1.near": { paused: "throws" } }));
      expect((await s.getPool("evil.poolv1.near")).refusals).toEqual(["pause-unknown"]);
    });
    it("fee missing, or above the 10 % cap (aurora.pool.near charges 99 %)", async () => {
      expect((await staking(chain({ "evil.poolv1.near": { fee: "missing" } })).s.getPool("evil.poolv1.near")).refusals).toEqual(["fee-unknown"]);
      expect((await staking(chain({ "aurora.pool.near": { fee: { numerator: 99, denominator: 100 }, codeHash: "5vf2Jkqpk11H7szLnY4XdPA6maJi1ND8xe346xtbtX8e" } })).s.getPool("aurora.pool.near")).refusals).toEqual(["fee-above-max"]);
    });
    it("paused pools and pools leaving the set", async () => {
      expect((await staking(chain({ "p.poolv1.near": { paused: true } })).s.getPool("p.poolv1.near")).refusals).toEqual(["paused"]);
      const leaving = chain({ "p.poolv1.near": {} });
      leaving.next = [];
      expect((await staking(leaving).s.getPool("p.poolv1.near")).refusals).toEqual(["not-in-next-set"]);
    });
  });

  it("listPools drops non-factory accounts and sorts by stake", async () => {
    const c = chain({ "a.poolv1.near": {}, "b.pool.near": {} }, { current: [{ id: "a.poolv1.near", stake: M }, { id: "b.pool.near", stake: 3n * M }, { id: "lst-pool.near", stake: 9n * M }], next: [] });
    const list = await staking(c).s.listPools();
    expect(list.map((p) => p.id)).toEqual(["b.pool.near", "a.poolv1.near"]);
    expect(list.every((p) => p.details === false && p.fee === null)).toBe(true);
  });

  it("the stake plan is one deposit_and_stake of exactly the amount, to an eligible pool only", async () => {
    const { s } = staking(chain({ "astro-stakers.poolv1.near": {}, "bad.poolv1.near": { paused: true } }));
    const q = await s.quoteStake({ amount: 730n * 10n ** 21n, pool: "astro-stakers.poolv1.near" });
    expect(q.transactions).toEqual([{ receiverId: "astro-stakers.poolv1.near", actions: [{ functionCall: { methodName: "deposit_and_stake", args: {}, gas: 50n * 10n ** 12n, deposit: 730n * 10n ** 21n } }] }]);
    await expect(s.quoteStake({ amount: 10n ** 24n, pool: "bad.poolv1.near" })).rejects.toThrow(/pool-not-allowed/);
  });

  it("unstake with an unlocked balance withdraws it first in the same transaction", async () => {
    const { s } = staking(chain({ "p.poolv1.near": { accounts: { "alice.near": { staked: 5n * 10n ** 24n, unstaked: 10n ** 24n, canWithdraw: true } } } }));
    const q = await s.quoteRequestWithdrawal({ amount: "all", pool: "p.poolv1.near" });
    expect(q.transactions[0]!.actions.map((a) => ("functionCall" in a ? a.functionCall.methodName : "?"))).toEqual(["withdraw_all", "unstake_all"]);
    expect(q.warnings.map((w) => w.code)).toEqual(["withdraws-unlocked-first"]);
  });

  it("unstake with a locked balance warns that the timer restarts", async () => {
    const { s } = staking(chain({ "p.poolv1.near": { accounts: { "alice.near": { staked: 5n * 10n ** 24n, unstaked: 10n ** 24n, canWithdraw: false } } } }));
    const q = await s.quoteRequestWithdrawal({ amount: 10n ** 24n, pool: "p.poolv1.near" });
    expect(q.resetsTimer).toBe(true);
    expect(q.transactions[0]!.actions).toHaveLength(1);
  });

  it("the preview never signs", () => {
    const { s } = staking(chain({}));
    expect(() => s.stake()).toThrow(PreviewWriteError);
    expect(() => s.requestWithdrawal()).toThrow(PreviewWriteError);
    expect(() => s.claimWithdrawals()).toThrow(PreviewWriteError);
  });
});
