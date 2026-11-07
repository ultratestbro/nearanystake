// End-to-end, read-only, on mainnet: the app's own code paths over the real staking modules.
// View calls on public NEAR RPCs and DRY 1Click quotes only: nothing is signed or sent, and no
// quote here has a deposit address. Run with `pnpm e2e` (E2E_REPORT=path also writes a JSON report).

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findAsset } from "@/lib/assets";
import { formatUnits } from "@/lib/format";
import { DRY_REFUND, depositAddressToShow } from "@/lib/dryrun";
import { DEMO_ACCOUNT, SUGGESTED_POOL } from "@/lib/near/config";
import { checkRecipient, nearClient } from "@/lib/near/reads";
import { watchAccount } from "@/lib/near/selector-account";
import { requestQuote, DryRunGuardError } from "@/lib/oneclick/client";
import { buildInboundQuoteRequest, verifyQuoteEcho, NEAR_ASSET } from "@/lib/oneclick/quote";
import type { QuoteResponse } from "@/lib/oneclick/types";
import { stakeAmountAfterDelivery } from "@/lib/stakeAmount";
import { LIQUID_OPTIONS, MIN_STAKE, liquidStaking, nativeStaking, stakingErrorText } from "@/lib/staking";

const units = (v: bigint, decimals: number) => formatUnits(v, decimals, decimals).replace(/,/g, "");
const near = (y: bigint) => `${units(y, 24)} NEAR`;
const hours = (ms: number) => `${(ms / 3_600_000).toFixed(2)} h`;
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x))) as unknown;
const report: Record<string, unknown> = { at: new Date().toISOString(), account: DEMO_ACCOUNT };
const log = (k: string, v: unknown) => {
  report[k] = json(v);
  console.log(`\n── ${k}\n${JSON.stringify(report[k], null, 2)}`);
};

const demo = watchAccount(DEMO_ACCOUNT, "mainnet");
const native = nativeStaking(demo);
const quotes: Record<string, QuoteResponse> = {};

describe("mainnet, read-only", () => {
  it("epoch clock: ~6.9 h epochs measured from the chain", async () => {
    const e = await native.getEpoch();
    log("epoch", { height: e.height, startBlock: e.startBlock, block: e.block, blocksLeft: e.blocksLeft, epochMs: e.epochMs, epoch: hours(e.epochMs), endsAt: new Date(e.endsAt).toISOString() });
    expect(e.length).toBe(43_200n);
    expect(e.epochMs).toBeGreaterThan(6 * 3_600_000);
    expect(e.epochMs).toBeLessThan(8 * 3_600_000);
  });

  it("validators: the allow-list admits factory pools with known code and refuses the rest", async () => {
    const stats = await native.getNetworkStats();
    const pools = await native.listPools();
    const ids = pools.filter((p) => p.inCurrentSet).map((p) => p.id);
    // contracts in the validator set that are not factory pools (lst-pool.near on 2026-11-08): never listed, refused locally
    const raw = (await nearClient().raw("validators", [null])) as { current_validators: Array<{ account_id: string }> };
    const foreignIds = raw.current_validators.map((v) => v.account_id).filter((id) => !/\.(poolv1|pool)\.near$/.test(id));
    const foreign = await Promise.all(foreignIds.map((id) => native.getPool(id)));
    const top = pools.filter((p) => p.inCurrentSet && p.factory !== null).slice(0, 6).map((p) => p.id);
    const detailed = await native.getPools([...new Set([SUGGESTED_POOL, ...top])]);
    log("validators", {
      networkGrossApr: stats.apr,
      validators: stats.validators,
      totalStake: near(stats.totalStake),
      listed: pools.length,
      inCurrentSet: ids.length,
      nonFactoryInSet: foreign.map((p) => ({ id: p.id, refusals: p.refusals })),
      pools: detailed.map((p) => ({ id: p.id, codeHashKnown: p.codeHashKnown, feePercent: p.feePercent, paused: p.paused, apr: p.apr, aprSource: p.aprSource, uptime: p.uptime, eligible: p.eligible, refusals: p.refusals })),
    });
    expect(stats.apr).toBeGreaterThan(3);
    expect(stats.apr).toBeLessThan(8);
    for (const p of foreign) {
      expect(p.refusals).toContain("not-factory-pool");
      expect(ids).not.toContain(p.id);
    }
    const suggested = detailed.find((p) => p.id === SUGGESTED_POOL)!;
    expect(suggested.codeHashKnown).toBe(true);
    expect(suggested.eligible).toBe(true);
  });

  it("APR: the suggested pool after its fee, and both liquid tokens from price growth", async () => {
    const apr = await native.getApr({ pool: SUGGESTED_POOL });
    const liquid: Record<string, unknown> = {};
    for (const o of LIQUID_OPTIONS) {
      const l = liquidStaking(demo, o.id);
      const info = await l.getPoolInfo();
      liquid[o.symbol] = { contract: info.contract, codeHash: info.codeHash, codeHashKnown: info.codeHashKnown, paused: info.paused, price: `${units(info.price, 24)} NEAR per token`, feeBps: info.feeBps, liquidity: near(info.liquidity), apr: await l.getApr() };
      expect(info.codeHashKnown).toBe(true);
      expect(info.paused).toBe(false);
    }
    log("apr", { [SUGGESTED_POOL]: apr, ...liquid });
    expect(apr).toBeGreaterThan(2);
  });

  it(`a public delegator's positions: ${DEMO_ACCOUNT}`, async () => {
    const positions = await native.listPositions();
    const requests = await native.getWithdrawalRequests();
    log("positions", {
      positions: positions.map((p) => ({ pool: p.pool, staked: near(p.staked), unstaked: near(p.unstaked), canWithdraw: p.canWithdraw, withdrawable: near(p.withdrawable), unlock: p.unlock && { epoch: p.unlock.epoch, earliestEpoch: p.unlock.earliestEpoch, latestEpoch: p.unlock.latestEpoch, at: p.unlock.at && new Date(p.unlock.at).toISOString(), earliestAt: new Date(p.unlock.earliestAt).toISOString(), source: p.unlock.source }, warnings: p.warnings })),
      requests: requests.requests.map((r) => ({ id: r.id, pool: r.pool, amount: near(r.amount), claimable: r.claimable, timestamp: r.timestamp })),
      pendingAmount: near(requests.pendingAmount),
      claimableAmount: near(requests.claimableAmount),
    });
    expect(positions.length).toBeGreaterThan(0);
  });

  it("the recipient is a real, existing NEAR account (1Click answers 400 for a missing named one)", async () => {
    const c = await checkRecipient(DEMO_ACCOUNT);
    log("recipient", c);
    expect(c).toMatchObject({ ok: true, exists: true });
  });

  const routes = [
    { key: "base-usdc", chain: "eip155:8453", symbol: "USDC", amount: 5_000_000n, family: "evm" },
    { key: "solana-sol", chain: "solana:mainnet", symbol: "SOL", amount: 50_000_000n, family: "solana" },
    { key: "tron-usdt", chain: "tron:728126428", symbol: "USDT", amount: 110_000_000n, family: "tron" },
  ] as const;
  for (const r of routes) {
    it(`dry 1Click quote: ${r.symbol} on ${r.chain} → native NEAR for ${DEMO_ACCOUNT}, echo verified`, async () => {
      const asset = findAsset(r.chain, r.symbol)!;
      expect(asset).toBeTruthy();
      const req = buildInboundQuoteRequest({ target: "near", originAsset: asset.assetId, amount: r.amount, recipient: DEMO_ACCOUNT, refundTo: DRY_REFUND[r.family]!, dry: true });
      expect(req.destinationAsset).toBe(NEAR_ASSET);
      expect("customRecipientMsg" in req).toBe(false);
      // the guard: in dry mode a non-dry request never leaves the process
      await expect(requestQuote({ ...req, dry: false }, { dryRun: true, direction: "inbound" })).rejects.toBeInstanceOf(DryRunGuardError);
      const res = await requestQuote(req, { dryRun: true, direction: "inbound" });
      quotes[r.key] = res;
      expect(verifyQuoteEcho(req, res)).toEqual({ ok: true });
      expect(res.quote.depositAddress ?? null).toBeNull();
      expect(depositAddressToShow(res, true)).toBeNull();
      log(`quote ${r.key}`, {
        send: `${units(r.amount, asset.decimals)} ${r.symbol} (${res.quote.amountInUsd ?? "?"} USD)`,
        deliver: `${units(BigInt(res.quote.amountOut), 24)} NEAR`,
        minimum: `${units(BigInt(res.quote.minAmountOut), 24)} NEAR`,
        amountOutUsd: res.quote.amountOutUsd,
        timeEstimateS: res.quote.timeEstimate,
        refundFee: res.quote.refundFee ?? null,
        depositAddress: res.quote.depositAddress ?? null,
        echo: "matches the approved request",
        signature: `${res.signature.slice(0, 18)}…`,
        quoteRequest: { recipient: res.quoteRequest.recipient, recipientType: res.quoteRequest.recipientType, destinationAsset: res.quoteRequest.destinationAsset, dry: res.quoteRequest.dry, refundTo: res.quoteRequest.refundTo },
      });
    });
  }

  it("build, not send: deposit_and_stake of the delivered NEAR into an allow-listed pool", async () => {
    const res = quotes["base-usdc"];
    expect(res).toBeTruthy();
    const delivered = BigInt(res!.quote.amountOut);
    const max = await native.getMaxStakeable();
    const amount = stakeAmountAfterDelivery({ reported: delivered, onChain: null, maxStakeable: max, minStake: MIN_STAKE });
    const q = await native.quoteStake({ amount: amount.amount, pool: SUGGESTED_POOL });
    const liquidQ = await liquidStaking(demo, "rnear").quoteStake({ amount: amount.amount });
    log("stake transaction (built, not sent)", {
      delivered: near(delivered),
      maxStakeable: near(max),
      willStake: near(amount.amount),
      basis: amount.basis,
      capped: amount.capped,
      native: { pool: q.pool.id, eligible: q.pool.eligible, feeBound: near(q.fee), apr: q.apr, transactions: q.transactions, warnings: q.warnings },
      rnear: { shares: `${units(liquidQ.shares, 24)} rNEAR`, feeBound: near(liquidQ.fee), transactions: liquidQ.transactions },
    });
    expect(q.transactions).toEqual([{ receiverId: SUGGESTED_POOL, actions: [{ functionCall: { methodName: "deposit_and_stake", args: {}, gas: 50n * 10n ** 12n, deposit: amount.amount } }] }]);
    expect(amount.amount).toBe(delivered < max ? delivered : max);
    // the demo is read-only: the same plan refuses to be signed
    await expect(native.stake({ amount: amount.amount, pool: SUGGESTED_POOL, expected: q.transactions })).rejects.toThrow(/read-only|ReadOnly|stake/);
  });

  it("exits on the demo account: unstake and claim plans (or the module's refusal, in words)", async () => {
    const out: Record<string, unknown> = {};
    try {
      const u = await native.quoteRequestWithdrawal({ amount: "all", pool: SUGGESTED_POOL });
      out.unstake = { transactions: u.transactions, resetsTimer: u.resetsTimer, withdrawsFirst: near(u.withdrawsFirst), unlockEarliest: new Date(u.unlock.earliestAt).toISOString(), warnings: u.warnings };
    } catch (e) {
      out.unstake = { refused: stakingErrorText(e) };
    }
    try {
      const c = await native.quoteClaimWithdrawals();
      out.claim = { amount: near(c.amount), transactions: c.transactions };
    } catch (e) {
      out.claim = { refused: stakingErrorText(e) };
    }
    log("exits", out);
  });

  it("writes the report", () => {
    if (process.env.E2E_REPORT) writeFileSync(process.env.E2E_REPORT, JSON.stringify(report, null, 2));
  });
});
