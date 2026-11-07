// PREVIEW backend, used only while the SDK packages on feat/near-staking still throw
// NotImplementedError for a method (see ../staking.ts). It reads the same chain data with view calls
// and returns the module API's shapes, so the UI shows live validators, epochs and positions before
// the integration step. It never sends anything: every write refuses with PreviewWriteError, so
// signing always goes through the real module and its fresh, fail-closed checks.

import { bigintToNumber, NotImplementedError, type IWalletAccount, type IWalletAccountReadOnly } from "@anywalletkit/core";
import {
  DEFAULT_GAS, DEFAULT_MAX_FEE, DEFAULT_RESERVE, DISPLAY_TTL_MS, EPOCH_LENGTH, FASTNEAR_API, KNOWN_POOL_CODE_HASHES, MIN_STAKE,
  NUM_EPOCHS_TO_UNLOCK, TREASURY_ACCOUNT, TYPICAL_EPOCH_MS, epochStartsAt, factoryOf, poolRequestId,
  type NativeStakingNearConfig, type NearClaimQuote, type NearEpoch, type NearNetworkStats, type NearPoolInfo, type NearPoolPosition,
  type NearStakedBalance, type NearStakeOptions, type NearStakeQuote, type NearStakingWarning, type NearUnstakeOptions, type NearUnstakeQuote,
  type NearWithdrawalRequestsView, type PoolRefusal, type PositionWarning, type UnlockEstimate,
} from "@anywalletkit/protocol-staking-native-near";
import {
  CONTRACT_MIN_RESERVE_BALANCE, DEFAULT_GAS as LIQUID_GAS, LIQUID_PRESETS, PRICE_SCALE, STORAGE_DEPOSIT, poolRequestId as liquidRequestId,
  type LiquidAccountDetails, type LiquidClaimQuote, type LiquidPoolInfo, type LiquidStakedBalance, type LiquidStakeOptions, type LiquidStakeQuote,
  type LiquidStakingWarning, type LiquidUnstakeOptions, type LiquidUnstakeQuote, type LiquidWithdrawalRequestsView,
} from "@anywalletkit/protocol-staking-liquid-near";
import { NearRpc, WalletAccountReadOnlyNear, createClient, type NearFetch, type NearProvider, type NearTransaction } from "@anywalletkit/wallet-near";
import { ARCHIVAL_RPC } from "../near/config";

export class PreviewWriteError extends Error {
  constructor(method: string) {
    super(`${method}: signing is enabled once the Any Wallet Kit staking modules are integrated (preview build).`);
    this.name = "PreviewWriteError";
  }
}

const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const FIXED = 10n ** 12n;

interface ValidatorsAnswer {
  epoch_height: number;
  epoch_start_height: number;
  current_validators: Array<{ account_id: string; stake: string; num_produced_blocks?: number; num_expected_blocks?: number; num_produced_chunks?: number; num_expected_chunks?: number }>;
  next_validators: Array<{ account_id: string; stake: string }>;
  validator_reward_paid_prev_epoch?: Record<string, string>;
}

const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

// caches are shared by every instance reading through the same endpoints (the app makes one per
// component); a transport function (tests) gets its own key
const fnKeys = new WeakMap<object, string>();
function providerKey(provider: NearProvider | NearProvider[] | undefined): string {
  const one = (p: NearProvider) => {
    if (typeof p === "string") return p;
    if (!fnKeys.has(p)) fnKeys.set(p, `fn${Math.random().toString(36).slice(2)}`);
    return fnKeys.get(p)!;
  };
  return provider === undefined ? "none" : Array.isArray(provider) ? provider.map(one).join("|") : one(provider);
}

function clientOf(provider: NearProvider | NearProvider[] | undefined): { raw: NearFetch; rpc: NearRpc; key: string } {
  const raw = provider === undefined ? undefined : createClient({ provider, timeoutMs: 15_000 });
  if (!raw) throw new Error("no-provider");
  return { raw, rpc: new NearRpc(raw), key: providerKey(provider) };
}

async function headerMs(raw: NearFetch, ref: { finality: "final" } | { block_id: number }): Promise<{ height: bigint; ms: number }> {
  const b = (await raw("block", ref)) as { header: { height: number; timestamp_nanosec: string } };
  return { height: BigInt(b.header.height), ms: bigintToNumber(BigInt(b.header.timestamp_nanosec) / 1_000_000n) };
}

async function headerNear(raw: NearFetch, height: bigint): Promise<{ height: bigint; ms: number } | null> {
  for (let i = 0n; i <= 10n; i++) {
    try {
      return await headerMs(raw, { block_id: bigintToNumber(height + i) });
    } catch {
      // a skipped height: try the next one
    }
  }
  return null;
}

async function epochOf(raw: NearFetch, validators: () => Promise<ValidatorsAnswer>, key: string): Promise<NearEpoch> {
  return cached(`${key}:epoch`, 60_000, async () => {
    const [v, latest] = await Promise.all([validators(), headerMs(raw, { finality: "final" })]);
    const startBlock = BigInt(v.epoch_start_height);
    const length = EPOCH_LENGTH;
    const [start, prev] = await Promise.all([headerNear(raw, startBlock), headerNear(raw, startBlock - length)]);
    const epochMs = start && prev && start.ms > prev.ms ? start.ms - prev.ms : TYPICAL_EPOCH_MS;
    const msPerBlock = epochMs / bigintToNumber(length);
    const blocksLeft = startBlock + length > latest.height ? startBlock + length - latest.height : 0n;
    return {
      height: BigInt(v.epoch_height),
      startBlock,
      length,
      block: latest.height,
      blocksLeft,
      startedAt: start?.ms ?? Math.round(latest.ms - bigintToNumber(latest.height - startBlock) * msPerBlock),
      epochMs,
      endsAt: Math.round(latest.ms + bigintToNumber(blocksLeft) * msPerBlock),
    };
  });
}

function unlockOf(epoch: NearEpoch, earliest: bigint, latest: bigint | null, exact: bigint | null, source: UnlockEstimate["source"]): UnlockEstimate {
  return {
    epoch: exact,
    earliestEpoch: earliest,
    latestEpoch: latest,
    at: exact !== null ? epochStartsAt(epoch, exact) : null,
    earliestAt: epochStartsAt(epoch, earliest),
    latestAt: latest !== null ? epochStartsAt(epoch, latest) : null,
    source,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]!);
    }
  }));
  return out;
}

const fc = (methodName: string, args: Record<string, unknown>, gas: bigint, deposit: bigint) => ({ functionCall: { methodName, args, gas, deposit } });

const ratio = (num: bigint, den: bigint) => (den > 0n ? bigintToNumber((num * FIXED) / den) / 1e12 : 0);

async function feeOf(rpc: NearRpc, txs: NearTransaction[]): Promise<bigint> {
  const price = await rpc.gasPrice();
  return txs.reduce((s, t) => s + WalletAccountReadOnlyNear.gasOf(t.actions, false) * price, 0n);
}

async function availableOf(rpc: NearRpc, id: string): Promise<bigint> {
  const v = await rpc.viewAccount(id);
  if (!v) return 0n;
  const a = BigInt(v.amount) - BigInt(v.locked) - BigInt(v.storage_usage) * 10n ** 19n;
  return a > 0n ? a : 0n;
}

// ── Native ─────────────────────────────────────────────────────────────────────────────────────

export class PreviewNativeStaking {
  private readonly raw: NearFetch;
  private readonly rpc: NearRpc;
  private readonly key: string;
  readonly maxFee: number;
  readonly reserve: bigint;
  readonly network = "mainnet" as const;

  constructor(private readonly account: IWalletAccountReadOnly | IWalletAccount, private readonly config: NativeStakingNearConfig) {
    ({ raw: this.raw, rpc: this.rpc, key: this.key } = clientOf(config.provider));
    this.maxFee = config.maxFee ?? DEFAULT_MAX_FEE;
    this.reserve = BigInt(config.reserve ?? DEFAULT_RESERVE);
  }

  private validators = () => cached(`${this.key}:validators`, 60_000, async () => (await this.raw("validators", [null])) as ValidatorsAnswer);

  getEpoch(): Promise<NearEpoch> {
    return epochOf(this.raw, this.validators, this.key);
  }

  async getNetworkStats(): Promise<NearNetworkStats> {
    const [v, e] = await Promise.all([this.validators(), this.getEpoch()]);
    const rewards = v.validator_reward_paid_prev_epoch ?? {};
    let stake = 0n;
    let paid = 0n;
    for (const c of v.current_validators) {
      if (c.account_id === TREASURY_ACCOUNT || !rewards[c.account_id]) continue;
      stake += BigInt(c.stake);
      paid += BigInt(rewards[c.account_id]!);
    }
    const epochsPerYear = YEAR_MS / e.epochMs;
    return {
      validators: v.current_validators.length,
      totalStake: v.current_validators.reduce((s, c) => s + BigInt(c.stake), 0n),
      epochMs: e.epochMs,
      epochsPerYear,
      apr: ratio(paid, stake) * epochsPerYear * 100,
    };
  }

  private light(v: ValidatorsAnswer, id: string, epochsPerYear: number): NearPoolInfo {
    const cur = v.current_validators.find((c) => c.account_id === id);
    const next = v.next_validators.find((c) => c.account_id === id);
    const reward = v.validator_reward_paid_prev_epoch?.[id];
    const stake = cur ? BigInt(cur.stake) : 0n;
    const blocks = cur?.num_expected_blocks ? (cur.num_produced_blocks ?? 0) / cur.num_expected_blocks : null;
    const chunks = cur?.num_expected_chunks ? (cur.num_produced_chunks ?? 0) / cur.num_expected_chunks : null;
    const uptime = cur ? (blocks ?? chunks ?? 1) * 100 : null;
    const listed = this.config.pools === "any" || this.config.pools.some((p) => (typeof p === "string" ? p : p.id) === id);
    const refusals: PoolRefusal[] = [];
    if (!listed) refusals.push("not-listed");
    if (!factoryOf(id, "mainnet")) refusals.push("not-factory-pool");
    if (!this.config.allowInactive) {
      if (!cur) refusals.push("not-in-current-set");
      if (!next) refusals.push("not-in-next-set");
    }
    return {
      id,
      name: null,
      factory: factoryOf(id, "mainnet"),
      details: false,
      codeHash: null,
      codeHashKnown: null,
      fee: null,
      feePercent: null,
      paused: null,
      stake,
      inCurrentSet: !!cur,
      inNextSet: !!next,
      uptime,
      grossApr: reward && stake > 0n ? ratio(BigInt(reward), stake) * epochsPerYear * 100 : null,
      apr: null,
      aprSource: null,
      listed,
      eligible: false,
      refusals,
    };
  }

  async listPools(): Promise<NearPoolInfo[]> {
    const [v, stats] = await Promise.all([this.validators(), this.getNetworkStats()]);
    const ids = [...new Set([...v.current_validators, ...v.next_validators].map((c) => c.account_id))].filter((id) => factoryOf(id, "mainnet"));
    return ids.map((id) => this.light(v, id, stats.epochsPerYear)).sort((a, b) => (b.stake > a.stake ? 1 : b.stake < a.stake ? -1 : 0));
  }

  async getPool(id: string): Promise<NearPoolInfo> {
    const [v, stats] = await Promise.all([this.validators(), this.getNetworkStats()]);
    const info = this.light(v, id, stats.epochsPerYear);
    info.details = true;
    if (!info.factory) return { ...info, refusals: info.refusals.filter((r) => r === "not-listed" || r === "not-factory-pool") };
    const refusals: PoolRefusal[] = info.refusals.filter((r) => r === "not-listed");
    const view = await this.rpc.viewAccount(id).catch(() => undefined);
    if (!view) return { ...info, refusals: [...refusals, "not-found"] };
    info.codeHash = view.code_hash ?? null;
    info.codeHashKnown = !!view.code_hash && [...KNOWN_POOL_CODE_HASHES.mainnet, ...(this.config.codeHashes ?? [])].includes(view.code_hash);
    if (!info.codeHashKnown) refusals.push("unknown-code");
    const [paused, fee] = await Promise.all([
      this.rpc.callFunction<unknown>(id, "is_staking_paused").catch(() => undefined),
      this.rpc.callFunction<unknown>(id, "get_reward_fee_fraction").catch(() => undefined),
    ]);
    if (typeof paused === "boolean") {
      info.paused = paused;
      if (paused) refusals.push("paused");
    } else refusals.push("pause-unknown");
    const f = fee as { numerator?: unknown; denominator?: unknown } | undefined;
    if (f && Number.isInteger(f.numerator) && Number.isInteger(f.denominator) && (f.denominator as number) > 0 && (f.numerator as number) >= 0 && (f.numerator as number) <= (f.denominator as number)) {
      const n = f.numerator as number;
      const d = f.denominator as number;
      info.fee = { numerator: n, denominator: d };
      info.feePercent = (n / d) * 100;
      if (BigInt(n) * 10_000n > BigInt(Math.round(this.maxFee * 100)) * BigInt(d)) refusals.push("fee-above-max");
      const gross = info.grossApr ?? stats.apr;
      info.apr = gross * (1 - n / d);
      info.aprSource = info.grossApr !== null ? "protocol" : "network";
    } else refusals.push("fee-unknown");
    refusals.push(...info.refusals.filter((r) => r === "not-in-current-set" || r === "not-in-next-set"));
    return { ...info, refusals, eligible: refusals.length === 0 };
  }

  getPools(ids: string[]): Promise<NearPoolInfo[]> {
    return mapLimit(ids, this.config.concurrency ?? 4, (id) => cached(`${this.key}:pool:${id}`, DISPLAY_TTL_MS, () => this.getPool(id)));
  }

  private async me(): Promise<string> {
    if (this.account.chain !== "near:mainnet") throw new Error("wrong-chain");
    return this.account.getAddress();
  }

  async listPositions(options: { pools?: string[] } = {}): Promise<NearPoolPosition[]> {
    const me = await this.me();
    const discovered = this.config.discover === false ? [] : await cached(`${this.key}:disc:${me}`, 30_000, async () => {
      const r = (await (await fetch(`${FASTNEAR_API.mainnet}/v1/account/${me}/staking`)).json()) as { pools?: Array<{ pool_id: string }> };
      return (r.pools ?? []).map((p) => p.pool_id);
    }).catch(() => [] as string[]);
    const listed = this.config.pools === "any" ? [] : this.config.pools.map((p) => (typeof p === "string" ? p : p.id));
    const ids = [...new Set([...listed, ...discovered, ...(options.pools ?? [])])].filter((id) => factoryOf(id, "mainnet"));
    const [v, stats, epoch] = await Promise.all([this.validators(), this.getNetworkStats(), this.getEpoch()]);
    const rows = await mapLimit(ids, this.config.concurrency ?? 4, async (pool) => {
      // a deleted pool account or one without the method is "no position"; anything else (rate limits) surfaces
      const a = await this.rpc
        .callFunction<{ staked_balance: string; unstaked_balance: string; can_withdraw: boolean } | null>(pool, "get_account", { account_id: me })
        .catch((e: unknown) => {
          if (/does not exist|UNKNOWN_ACCOUNT|MethodNotFound|CodeDoesNotExist|no contract/i.test(String((e as Error)?.message ?? e))) return null;
          throw e;
        });
      if (!a) return null;
      const staked = BigInt(a.staked_balance);
      const unstaked = BigInt(a.unstaked_balance);
      if (staked === 0n && unstaked === 0n) return null;
      const poolInfo = this.light(v, pool, stats.epochsPerYear);
      const fee = await this.rpc.callFunction<{ numerator: number; denominator: number }>(pool, "get_reward_fee_fraction").catch(() => null);
      if (fee && fee.denominator > 0) {
        poolInfo.fee = fee;
        poolInfo.feePercent = (fee.numerator / fee.denominator) * 100;
        poolInfo.apr = (poolInfo.grossApr ?? stats.apr) * (1 - fee.numerator / fee.denominator);
        poolInfo.aprSource = poolInfo.grossApr !== null ? "protocol" : "network";
      }
      const warnings: PositionWarning[] = [];
      if (poolInfo.feePercent !== null && poolInfo.feePercent > this.maxFee) warnings.push("pool-fee-above-max");
      if (poolInfo.inCurrentSet && !poolInfo.inNextSet) warnings.push("pool-leaving-set");
      if (!poolInfo.inCurrentSet && !poolInfo.inNextSet) warnings.push("pool-not-in-set");
      const position: NearPoolPosition = {
        pool,
        name: null,
        staked,
        unstaked,
        canWithdraw: a.can_withdraw,
        withdrawable: a.can_withdraw ? unstaked : 0n,
        unlock: unstaked > 0n && !a.can_withdraw ? unlockOf(epoch, epoch.height + 1n, epoch.height + NUM_EPOCHS_TO_UNLOCK, null, "estimate") : null,
        poolInfo,
        warnings,
      };
      return position;
    });
    return rows.filter((r): r is NearPoolPosition => r !== null);
  }

  async getStakedBalance(): Promise<NearStakedBalance> {
    const positions = await this.listPositions();
    const sum = (f: (p: NearPoolPosition) => bigint) => positions.reduce((s, p) => s + f(p), 0n);
    const balance = sum((p) => p.staked);
    const unstaked = sum((p) => p.unstaked);
    return { balance, total: balance + unstaked, wrappedBalance: 0n, rate: 0n, unstaked, withdrawable: sum((p) => p.withdrawable), positions } as NearStakedBalance;
  }

  async getWithdrawalRequests(): Promise<NearWithdrawalRequestsView> {
    const positions = (await this.listPositions()).filter((p) => p.unstaked > 0n);
    const requests = positions.map((p) => ({ id: poolRequestId(p.pool), amount: p.unstaked, timestamp: 0, claimable: p.canWithdraw, pool: p.pool, unlock: p.unlock }));
    return { requests, claimableIds: requests.filter((r) => r.claimable).map((r) => r.id).sort((a, b) => (a < b ? -1 : 1)) } as unknown as NearWithdrawalRequestsView;
  }

  async getMaxStakeable(): Promise<bigint> {
    const me = await this.me();
    const tx: NearTransaction = { receiverId: "x.poolv1.near", actions: [fc("deposit_and_stake", {}, DEFAULT_GAS.stake, 0n)] };
    const [available, fee] = await Promise.all([availableOf(this.rpc, me), feeOf(this.rpc, [tx])]);
    const m = available - this.reserve - fee;
    return m > 0n ? m : 0n;
  }

  async getApr(options: { pool?: string } = {}): Promise<number> {
    if (options.pool) return (await this.getPool(options.pool)).apr ?? 0;
    return (await this.getNetworkStats()).apr * 0.9;
  }

  async quoteStake(o: NearStakeOptions): Promise<NearStakeQuote> {
    const amount = BigInt(o.amount);
    if (amount < MIN_STAKE) throw new Error("below-minimum");
    if (!o.pool) throw new Error("pool-required");
    const pool = await this.getPool(o.pool);
    if (!pool.eligible) throw Object.assign(new Error(`pool-not-allowed: ${pool.refusals.join(", ")}`), { refusals: pool.refusals });
    const transactions: NearTransaction[] = [{ receiverId: pool.id, actions: [fc("deposit_and_stake", {}, DEFAULT_GAS.stake, amount)] }];
    const [fee, maxStakeable] = await Promise.all([feeOf(this.rpc, transactions), this.getMaxStakeable()]);
    const warnings: NearStakingWarning[] = pool.aprSource === "network" ? [{ code: "apr-network-fallback", message: "This pool has no reward data yet: the APR shown is the network average after its fee." }] : [];
    return { fee, amount, pool, apr: pool.apr, maxStakeable, transactions, warnings };
  }

  async quoteRequestWithdrawal(o: NearUnstakeOptions): Promise<NearUnstakeQuote> {
    const me = await this.me();
    if (!o.pool || !factoryOf(o.pool, "mainnet")) throw new Error("pool-required");
    const a = await this.rpc.callFunction<{ staked_balance: string; unstaked_balance: string; can_withdraw: boolean }>(o.pool, "get_account", { account_id: me });
    const staked = BigInt(a.staked_balance);
    const unstaked = BigInt(a.unstaked_balance);
    if (staked === 0n) throw new Error("nothing-staked");
    const all = o.amount === "all";
    const amount = all ? staked : BigInt(o.amount as bigint | number);
    if (amount > staked) throw new Error("exceeds-staked");
    const unstakeCall = all ? fc("unstake_all", {}, DEFAULT_GAS.unstake, 0n) : fc("unstake", { amount: amount.toString() }, DEFAULT_GAS.unstake, 0n);
    const withdrawFirst = unstaked > 0n && a.can_withdraw;
    const transactions: NearTransaction[] = [{ receiverId: o.pool, actions: withdrawFirst ? [fc("withdraw_all", {}, DEFAULT_GAS.withdraw, 0n), unstakeCall] : [unstakeCall] }];
    const warnings: NearStakingWarning[] = [];
    if (withdrawFirst) warnings.push({ code: "withdraws-unlocked-first", message: "Your unlocked NEAR in this pool is withdrawn first, in the same transaction, so it doesn't lock again." });
    if (unstaked > 0n && !a.can_withdraw) warnings.push({ code: "resets-unbonding-timer", message: "You already have NEAR unbonding here: a new unstake restarts the 4-epoch wait for all of it." });
    const epoch = await this.getEpoch();
    return {
      fee: await feeOf(this.rpc, transactions),
      amount,
      pool: o.pool,
      id: poolRequestId(o.pool),
      withdrawsFirst: withdrawFirst ? unstaked : 0n,
      resetsTimer: unstaked > 0n && !a.can_withdraw,
      unlock: unlockOf(epoch, epoch.height + NUM_EPOCHS_TO_UNLOCK, epoch.height + NUM_EPOCHS_TO_UNLOCK + 1n, null, "estimate"),
      transactions,
      warnings,
    };
  }

  async quoteClaimWithdrawals(o: { pools?: string[] } = {}): Promise<NearClaimQuote> {
    const ready = (await this.listPositions(o)).filter((p) => p.unstaked > 0n && p.canWithdraw);
    if (!ready.length) throw new Error("nothing-to-claim");
    const transactions: NearTransaction[] = ready.map((p) => ({ receiverId: p.pool, actions: [fc("withdraw_all", {}, DEFAULT_GAS.withdraw, 0n)] }));
    return {
      fee: await feeOf(this.rpc, transactions),
      amount: ready.reduce((s, p) => s + p.unstaked, 0n),
      claims: ready.map((p) => ({ id: poolRequestId(p.pool), pool: p.pool, amount: p.unstaked })),
      transactions,
    };
  }

  stake(): never {
    throw new PreviewWriteError("stake");
  }
  requestWithdrawal(): never {
    throw new PreviewWriteError("requestWithdrawal");
  }
  claimWithdrawals(): never {
    throw new PreviewWriteError("claimWithdrawals");
  }
}

// ── Liquid (LiNEAR family) ─────────────────────────────────────────────────────────────────────

export class PreviewLiquidStaking {
  private readonly raw: NearFetch;
  private readonly rpc: NearRpc;
  private readonly key: string;
  readonly contract: string;
  readonly symbol: string;
  readonly name: string;
  readonly codeHashes: readonly string[];
  readonly reserve = DEFAULT_RESERVE;
  readonly network = "mainnet" as const;

  constructor(private readonly account: IWalletAccountReadOnly | IWalletAccount, config: { pool: keyof typeof LIQUID_PRESETS; provider?: NearProvider | NearProvider[] }) {
    ({ raw: this.raw, rpc: this.rpc, key: this.key } = clientOf(config.provider));
    const p = LIQUID_PRESETS[config.pool];
    this.contract = p.contracts.mainnet.contract;
    this.codeHashes = p.contracts.mainnet.codeHashes;
    this.symbol = p.symbol;
    this.name = p.name;
  }

  private validators = () => cached(`${this.key}:validators`, 60_000, async () => (await this.raw("validators", [null])) as ValidatorsAnswer);

  getEpoch(): Promise<NearEpoch> {
    return epochOf(this.raw, this.validators, this.key);
  }

  private async me(): Promise<string> {
    if (this.account.chain !== "near:mainnet") throw new Error("wrong-chain");
    return this.account.getAddress();
  }

  getPoolInfo(): Promise<LiquidPoolInfo> {
    return cached(`${this.key}:lst:${this.contract}`, 30_000, async () => {
      const [meta, summary, paused, view, bens] = await Promise.all([
        this.rpc.callFunction<{ name: string; symbol: string }>(this.contract, "ft_metadata"),
        this.rpc.callFunction<{ total_share_amount: string; total_staked_near_amount: string; ft_price: string; validators_num: number }>(this.contract, "get_summary"),
        this.rpc.callFunction<unknown>(this.contract, "is_paused").catch(() => undefined),
        this.rpc.viewAccount(this.contract),
        this.rpc.callFunction<Record<string, number>>(this.contract, "get_beneficiaries").catch(() => ({})),
      ]);
      const codeHash = view?.code_hash ?? "";
      return {
        contract: this.contract,
        symbol: meta.symbol,
        name: this.name,
        decimals: 24,
        price: BigInt(summary.ft_price),
        totalStaked: BigInt(summary.total_staked_near_amount),
        totalShares: BigInt(summary.total_share_amount),
        validators: summary.validators_num,
        paused: paused !== false,
        codeHash,
        codeHashKnown: this.codeHashes.includes(codeHash),
        liquidity: view ? BigInt(view.amount) : 0n,
        feeBps: Object.values(bens ?? {}).reduce((s, x) => s + Number(x), 0),
      };
    });
  }

  async getAccountDetails(): Promise<LiquidAccountDetails> {
    const me = await this.me();
    const [info, shares, d, reg] = await Promise.all([
      this.getPoolInfo(),
      this.rpc.callFunction<string>(this.contract, "ft_balance_of", { account_id: me }).catch(() => "0"),
      this.rpc.callFunction<{ unstaked_balance: string; unstaked_available_epoch_height: number; can_withdraw: boolean }>(this.contract, "get_account_details", { account_id: me }).catch(() => null),
      this.rpc.callFunction<unknown>(this.contract, "storage_balance_of", { account_id: me }).catch(() => null),
    ]);
    const s = BigInt(shares ?? "0");
    return {
      shares: s,
      value: (s * info.price) / PRICE_SCALE,
      unstaked: d ? BigInt(d.unstaked_balance) : 0n,
      unlockEpoch: d ? BigInt(d.unstaked_available_epoch_height) : 0n,
      canWithdraw: d?.can_withdraw ?? false,
      registered: reg !== null,
    };
  }

  async getApr(): Promise<number> {
    return cached(`${this.key}:lst-apr:${this.contract}`, 10 * 60_000, async () => {
      const archival = createClient({ provider: ARCHIVAL_RPC, timeoutMs: 20_000 })!;
      const latest = await headerMs(this.raw, { finality: "final" });
      const pastHeight = latest.height - 24n * EPOCH_LENGTH;
      const past = await headerNear(archival, pastHeight);
      if (!past) throw new Error("no archival block");
      const priceAt = async (fetcher: NearFetch, blockId: bigint) => {
        const r = (await fetcher("query", { request_type: "call_function", account_id: this.contract, method_name: "ft_price", args_base64: btoa("{}"), block_id: bigintToNumber(blockId) })) as { result: number[] };
        return BigInt(JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result))) as string);
      };
      const [p1, p0] = await Promise.all([priceAt(this.raw, latest.height), priceAt(archival, past.height)]);
      const growth = ratio(p1 - p0, p0);
      return (growth * YEAR_MS) / (latest.ms - past.ms) * 100;
    });
  }

  async getMaxStakeable(): Promise<bigint> {
    const me = await this.me();
    const tx: NearTransaction = { receiverId: this.contract, actions: [fc("deposit_and_stake", {}, LIQUID_GAS.stake, 0n)] };
    const [available, fee, d] = await Promise.all([availableOf(this.rpc, me), feeOf(this.rpc, [tx]), this.getAccountDetails()]);
    const m = available - this.reserve - fee - (d.registered ? 0n : STORAGE_DEPOSIT);
    return m > 0n ? m : 0n;
  }

  async getStakedBalance(): Promise<LiquidStakedBalance> {
    const [info, d] = await Promise.all([this.getPoolInfo(), this.getAccountDetails()]);
    const payable = info.liquidity - CONTRACT_MIN_RESERVE_BALANCE >= d.unstaked;
    return { balance: d.shares, wrappedBalance: 0n, rate: info.price, total: d.value, unstaked: d.unstaked, withdrawable: d.canWithdraw && payable ? d.unstaked : 0n, price: info.price } as LiquidStakedBalance;
  }

  async getWithdrawalRequests(): Promise<LiquidWithdrawalRequestsView> {
    const [info, d, epoch] = await Promise.all([this.getPoolInfo(), this.getAccountDetails(), this.getEpoch()]);
    if (d.unstaked === 0n) return { requests: [], claimableIds: [] } as unknown as LiquidWithdrawalRequestsView;
    const awaitingLiquidity = d.canWithdraw && info.liquidity - CONTRACT_MIN_RESERVE_BALANCE < d.unstaked;
    const claimable = d.canWithdraw && !awaitingLiquidity;
    const id = liquidRequestId(this.contract);
    const request = { id, amount: d.unstaked, timestamp: 0, claimable, contract: this.contract, unlockEpoch: d.unlockEpoch, awaitingLiquidity, unlock: claimable ? null : unlockOf(epoch, d.unlockEpoch, d.unlockEpoch, d.unlockEpoch, "contract") };
    return { requests: [request], claimableIds: claimable ? [id] : [] } as unknown as LiquidWithdrawalRequestsView;
  }

  async quoteStake(o: LiquidStakeOptions): Promise<LiquidStakeQuote> {
    const me = await this.me();
    const amount = BigInt(o.amount);
    const [info, d] = await Promise.all([this.getPoolInfo(), this.getAccountDetails()]);
    if (!info.codeHashKnown) throw new Error("unknown-contract-code");
    if (info.paused) throw new Error("contract-paused");
    const actions = [...(d.registered ? [] : [fc("storage_deposit", { account_id: me, registration_only: true }, LIQUID_GAS.storage, STORAGE_DEPOSIT)]), fc("deposit_and_stake", {}, LIQUID_GAS.stake, amount)];
    const transactions: NearTransaction[] = [{ receiverId: this.contract, actions }];
    const warnings: LiquidStakingWarning[] = d.registered ? [] : [{ code: "registers-storage", message: `The first stake registers your account on ${this.symbol} (0.00125 NEAR).` }];
    const [fee, maxStakeable, apr] = await Promise.all([feeOf(this.rpc, transactions), this.getMaxStakeable(), this.getApr().catch(() => null)]);
    return { fee, amount, shares: (amount * PRICE_SCALE) / info.price, price: info.price, storageDeposit: d.registered ? 0n : STORAGE_DEPOSIT, apr, maxStakeable, transactions, warnings };
  }

  async quoteRequestWithdrawal(o: LiquidUnstakeOptions): Promise<LiquidUnstakeQuote> {
    const [info, d, epoch] = await Promise.all([this.getPoolInfo(), this.getAccountDetails(), this.getEpoch()]);
    if (d.shares === 0n) throw new Error("nothing-staked");
    const all = o.amount === "all" || BigInt(o.amount as bigint | number) === d.shares;
    const shares = all ? d.shares : BigInt(o.amount as bigint | number);
    if (shares > d.shares) throw new Error("exceeds-balance");
    const near = (shares * info.price) / PRICE_SCALE;
    const call = all ? fc("unstake_all", {}, LIQUID_GAS.unstake, 0n) : fc("unstake", { amount: near.toString() }, LIQUID_GAS.unstake, 0n);
    const payable = info.liquidity - CONTRACT_MIN_RESERVE_BALANCE >= d.unstaked;
    const withdrawFirst = d.unstaked > 0n && d.canWithdraw && payable;
    const transactions: NearTransaction[] = [{ receiverId: this.contract, actions: withdrawFirst ? [fc("withdraw_all", {}, LIQUID_GAS.withdraw, 0n), call] : [call] }];
    const warnings: LiquidStakingWarning[] = [{ code: "unlock-may-be-later", message: "At least 4 epochs (~28 h); the contract may add more. The exact epoch shows after the unstake." }];
    if (withdrawFirst) warnings.push({ code: "withdraws-unlocked-first", message: "Your unlocked NEAR is withdrawn first, in the same transaction." });
    if (d.unstaked > 0n && !d.canWithdraw) warnings.push({ code: "resets-unbonding-timer", message: "NEAR already unbonding here restarts its wait." });
    return {
      fee: await feeOf(this.rpc, transactions),
      shares,
      amount: near,
      id: liquidRequestId(this.contract),
      withdrawsFirst: withdrawFirst ? d.unstaked : 0n,
      resetsTimer: d.unstaked > 0n && !d.canWithdraw,
      relocks: 0n,
      unlock: unlockOf(epoch, epoch.height + 4n, null, null, "estimate"),
      transactions,
      warnings,
    };
  }

  async quoteClaimWithdrawals(): Promise<LiquidClaimQuote> {
    const [info, d] = await Promise.all([this.getPoolInfo(), this.getAccountDetails()]);
    if (d.unstaked === 0n) throw new Error("nothing-to-claim");
    if (!d.canWithdraw) throw new Error("not-withdrawable");
    if (info.liquidity - CONTRACT_MIN_RESERVE_BALANCE < d.unstaked) throw new Error("awaiting-liquidity");
    const transactions: NearTransaction[] = [{ receiverId: this.contract, actions: [fc("withdraw_all", {}, LIQUID_GAS.withdraw, 0n)] }];
    return { fee: await feeOf(this.rpc, transactions), amount: d.unstaked, transactions };
  }

  stake(): never {
    throw new PreviewWriteError("stake");
  }
  requestWithdrawal(): never {
    throw new PreviewWriteError("requestWithdrawal");
  }
  claimWithdrawals(): never {
    throw new PreviewWriteError("claimWithdrawals");
  }
}

export const isNotImplemented = (e: unknown) => e instanceof NotImplementedError || (e instanceof Error && e.name === "NotImplementedError");
