"use client";

// The Portfolio (direction C): what is staked and what it earns, what is on its way out, every
// position with the action that fits its state, the NEAR left on the account with a way to cash it
// out, today's rates, and recent activity (passed in as `activity`). Reads are the staking modules';
// the dialogs are in PositionModals, the cards in PositionCard.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { duration, formatNear, formatUnits, percent, shortAccount } from "@/lib/format";
import { nearSpendable } from "@/lib/near/reads";
import { listTokens } from "@/lib/oneclick/client";
import { heroAmount, smallNear, summarize, usdText, type Holding } from "@/lib/portfolio";
import { DEFAULT_RESERVE, LIQUID_OPTIONS, UNSTAKED_DUST, refusalText, type LiquidPreset, type NearEpoch, type UnlockEstimate } from "@/lib/staking";
import { useAsync, useNow } from "@/lib/useAsync";
import { useApp } from "./AppProvider";
import { EpochClock, unbondingWindow, useEpoch } from "./EpochClock";
import { useAccountStaking, useNetworkStaking } from "./hooks";
import { ArrowRightIcon, PlusIcon } from "./icons";
import { Modal } from "./Modal";
import { LiquidPositionCard, NativePositionCard, liquidHolding, type LiquidData } from "./PositionCard";
import { ClaimModal } from "./PositionModals";
import { StatusBadge } from "./StatusBadge";
import { Banner, Skeleton } from "./ui";
import { WithdrawOut } from "./WithdrawOut";

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };
const settle = <T,>(p: Promise<T>): Promise<Settled<T>> => p.then((value) => ({ ok: true as const, value }), (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));

/** Under this, NEAR left on the account is the stake's gas reserve and refunded gas, not savings. */
const RESERVE_LIKE = 25n * 10n ** 22n; // 0.25 NEAR

type Mode = "mine" | "demo" | "connect" | "restoring";

export function Positions({ activity }: { activity?: ReactNode }) {
  const params = useSearchParams();
  const { near, demoId, restoring } = useApp();
  const mode: Mode = params.get("view") === "demo" ? "demo" : near ? "mine" : restoring ? "restoring" : "connect";
  const s = useAccountStaking(mode === "mine" ? "mine" : "demo");
  const account = s.accountId ?? demoId;
  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <h1 className="sr-only">Portfolio</h1>
      {mode === "demo" && <DemoNote />}
      {/* keyed by account: figures of one account never show under another while the next one loads */}
      <Dashboard key={`${mode}:${account}`} mode={mode} account={account} s={s} activity={activity} />
    </div>
  );
}

function DemoNote() {
  const { near, demoId, connectNear, connecting } = useApp();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-panel px-4 py-2.5 text-sm">
      <StatusBadge>Demo</StatusBadge>
      <p className="min-w-0 flex-[1_1_16rem] text-muted">
        <span className="font-mono text-text">{demoId}</span> is a public account with NEAR unstaking. Read-only: preview unstake and withdraw, nothing can be signed.
      </p>
      {near ? (
        <Link href="/portfolio" className="inline-flex min-h-11 items-center font-medium text-accent hover:underline">
          Show my account
        </Link>
      ) : (
        <button type="button" onClick={() => void connectNear()} disabled={connecting} className="inline-flex min-h-11 items-center font-medium text-accent hover:underline disabled:opacity-60">
          {connecting ? "Connecting…" : "Connect my wallet"}
        </button>
      )}
    </div>
  );
}

function Dashboard({ mode, account, s, activity }: { mode: Mode; account: string; s: ReturnType<typeof useAccountStaking>; activity?: ReactNode }) {
  const on = mode === "mine" || mode === "demo";
  const network = useNetworkStaking();
  const now = useNow(30_000);
  const epoch = useEpoch().data;

  // getStakedBalance, not listPositions: when the pool lookup is down it still shows the known pools and says so
  const balance = useAsync(on ? () => s.native.getStakedBalance() : null, [s, on], 60_000);
  const liquidAcct = useAsync(
    on ? () => Promise.all(LIQUID_OPTIONS.map((o) => settle(Promise.all([s.liquid[o.id].getAccountDetails(), s.liquid[o.id].getWithdrawalRequests()])))) : null,
    [s, on],
    60_000,
  );
  const liquidPool = useAsync(() => Promise.all(LIQUID_OPTIONS.map((o) => settle(s.liquid[o.id].getPoolInfo()))), [s], 60_000);
  const liquidApr = useAsync(() => Promise.all(LIQUID_OPTIONS.map((o) => s.liquid[o.id].getApr().catch(() => null))), [s]);
  const stats = useAsync(() => network.getNetworkStats(), [network]);
  const price = useAsync(() => listTokens().then((ts) => ts.find((t) => t.assetId === "nep141:wrap.near")?.price ?? null), []).data ?? null;
  const spendable = useAsync(on ? () => nearSpendable(account) : null, [account, on], 30_000);
  const [claim, setClaim] = useState(false);

  const reloadBalance = balance.reload;
  const reloadLiquid = liquidAcct.reload;
  const reloadSpendable = spendable.reload;
  const onNativeDone = useCallback(() => {
    reloadBalance();
    reloadSpendable();
  }, [reloadBalance, reloadSpendable]);
  const onLiquidDone = useCallback(() => {
    reloadLiquid();
    reloadSpendable();
  }, [reloadLiquid, reloadSpendable]);

  // per preset: the position (account + pool reads), or why it couldn't be read
  const liquid = LIQUID_OPTIONS.map((o, i) => {
    const a = liquidAcct.data?.[i];
    const p = liquidPool.data?.[i];
    const apr = liquidApr.data?.[i] ?? null;
    if (!a || !p) return { id: o.id, label: o.label, apr, state: "loading" as const };
    if (!a.ok || !p.ok) return { id: o.id, label: o.label, apr, state: "error" as const, error: !a.ok ? a.error : !p.ok ? p.error : "" };
    const data: LiquidData = { details: a.value[0], request: a.value[1].requests[0], info: p.value };
    return { id: o.id, label: o.label, apr, state: "ok" as const, data };
  });

  const native = (balance.data?.positions ?? []).filter((p) => p.staked >= UNSTAKED_DUST || p.unstaked >= UNSTAKED_DUST);
  const held = liquid.filter((l) => l.state === "ok" && (l.data.details.shares > 0n || l.data.request));
  const loaded = on && balance.data !== undefined && liquidAcct.data !== undefined && liquidPool.data !== undefined;
  const holdings: Holding[] = [
    // rounding dust left in a pool after an unstake is not stake
    ...native.map((p) => ({ staked: p.staked >= UNSTAKED_DUST ? p.staked : 0n, unstaking: p.unstaked >= UNSTAKED_DUST && !p.canWithdraw ? p.unstaked : 0n, ready: p.withdrawable, apr: p.poolInfo?.apr ?? null })),
    ...held.flatMap((l) => (l.state === "ok" ? [{ ...liquidHolding(l.data), staked: l.data.details.value, apr: l.apr }] : [])),
  ];
  const sum = summarize(holdings);
  const unlocks = [...native.map((p) => p.unlock), ...held.map((l) => (l.state === "ok" ? l.data.request?.unlock : null))].filter((u): u is UnlockEstimate => !!u).map((u) => u.at ?? u.earliestAt);
  const soonest = unlocks.length ? Math.min(...unlocks) : null;
  const count = native.length + held.length;
  // nothing earning but NEAR still in pools: the hero shows that NEAR and the step it waits for
  const inPools = sum.unstaking + sum.ready;
  const unstakedOnly = sum.staked === 0n && inPools > 0n;
  const nativeReady = native.reduce((a, p) => a + p.withdrawable, 0n);
  const heroWithdraw = unstakedOnly && nativeReady > 0n;
  const eyebrow = !unstakedOnly ? "Total staked" : sum.unstaking === 0n ? "Ready to withdraw" : sum.ready === 0n ? "Unstaking" : "Unstaked, still in pools";

  return (
    <>
      {mode === "connect" ? <ConnectHero /> : mode === "restoring" ? <Skeleton className="h-64 w-full rounded-3xl" /> : (
        <section aria-labelledby="total-h" className="rounded-3xl border border-line bg-panel p-5 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-0">
              <h2 id="total-h" className="text-sm font-medium text-muted">
                {eyebrow}
                {mode === "demo" && <span className="font-normal"> · {shortAccount(account)}</span>}
              </h2>
              {balance.error ? (
                <p className="mt-2 text-4xl font-semibold text-muted">—</p>
              ) : !loaded ? (
                <Skeleton className="mt-3 h-[4.5rem] w-60 max-w-full" />
              ) : (
                <p className="mt-2 flex flex-wrap items-baseline gap-x-3 font-semibold tabular-nums">
                  <span className="text-[length:clamp(2.5rem,7vw,4rem)] leading-[1.15] tracking-[-0.03em]">{heroAmount(unstakedOnly ? inPools : sum.staked)}</span>
                  <span className="text-[28px] font-medium leading-9 text-muted">NEAR</span>
                </p>
              )}
              {loaded &&
                (unstakedOnly ? (
                  <UnstakedLine ready={sum.ready} unstaking={sum.unstaking} price={price} unlockIn={soonest !== null && soonest > now ? duration(soonest - now) : null} />
                ) : (
                  <HeroLine staked={sum.staked} yearly={sum.yearly} apr={sum.apr} partialApr={sum.aprPartial} price={price} />
                ))}
              {balance.data?.partial && <p className="mt-1 text-sm text-warn">Known pools only: the pool lookup is down right now.</p>}
            </div>
            {heroWithdraw ? (
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row-reverse">
                <button type="button" onClick={() => setClaim(true)} className="btn-tactile-accent h-14 justify-center px-7 text-base">
                  Withdraw
                </button>
                <Link href="/stake" className="btn-tactile h-14 justify-center px-6 text-base font-medium">
                  <PlusIcon size={20} />
                  Stake more
                </Link>
              </div>
            ) : (
              <Link href="/stake" className="btn-tactile-accent h-14 w-full justify-center px-7 text-base sm:w-auto">
                <PlusIcon size={20} />
                {mode === "mine" && sum.staked > 0n ? "Stake more" : "Stake NEAR"}
              </Link>
            )}
          </div>
          {claim && <ClaimModal native={s.native} readOnly={s.readOnly} account={account} onClose={() => setClaim(false)} onDone={onNativeDone} />}
          <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(100%,140px),1fr))] gap-x-4 gap-y-5 border-t border-line pt-6 sm:mt-8 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] sm:gap-6">
            <EpochClock compact label={sum.staked > 0n ? "Next reward" : "Next epoch"} />
            <Cell
              label="Unstaking"
              value={loaded ? (sum.unstaking > 0n ? formatNear(sum.unstaking) : "None") : undefined}
              quiet={sum.unstaking === 0n}
              hint={
                sum.unstaking > 0n
                  ? soonest !== null && soonest > now
                    ? `First unlock in ${duration(soonest - now)}`
                    : "Unlocks at the next epoch boundary"
                  : `Takes about ${epoch ? `${Math.max(1, Math.round((unbondingWindow(epoch).at - now) / 3_600_000))} h` : "21–28 h"} once you start`
              }
            />
            <Cell
              label="Ready to withdraw"
              value={loaded ? (sum.ready > 0n ? formatNear(sum.ready) : "None") : undefined}
              quiet={sum.ready === 0n}
              accent={sum.ready > 0n}
              hint={sum.ready > 0n ? "Withdraw it from the position below" : "Unlocked NEAR shows up here"}
            />
          </div>
        </section>
      )}

      <div className="grid items-start gap-x-6 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:grid-rows-[auto_1fr]">
        {on && (
          <section aria-labelledby="pos-h" className="min-w-0 lg:col-start-1 lg:row-start-1">
            <div className="mb-2 flex min-h-11 items-center justify-between gap-4">
              <h2 id="pos-h" className="text-xl font-semibold">
                Your positions
              </h2>
              {loaded && <span className="text-sm text-muted">{count === 1 ? "1 position" : `${count} positions`}</span>}
            </div>
            <div className="flex flex-col gap-4">
              {balance.error && <Banner tone="danger" title="Couldn't read your stake">{balance.error}</Banner>}
              {balance.data?.partial && (
                <Banner tone="warn" title="Pool lookup is down">
                  fastnear&apos;s index didn&apos;t answer, so only pools this app already knows are shown. Stake elsewhere is safe; it shows up again once the lookup is back.
                </Banner>
              )}
              {!loaded && !balance.error && <Skeleton className="h-72 w-full rounded-[20px]" />}
              {loaded && count === 0 && !balance.error && (
                <div className="rounded-[20px] border border-dashed border-line px-6 py-8 text-center">
                  <p className="font-medium">Nothing staked on {shortAccount(account)} yet</p>
                  <p className="mt-1 text-sm text-muted">Pay with USDC, SOL, ETH or 40+ other tokens; one signature stakes the NEAR that arrives.</p>
                </div>
              )}
              {loaded &&
                native.map((p) => (
                  <NativePositionCard key={p.pool} p={p} native={s.native} readOnly={s.readOnly} account={account} epoch={epoch} price={price} onDone={onNativeDone} quietWithdraw={heroWithdraw} />
                ))}
              {loaded &&
                held.map((l) =>
                  l.state === "ok" ? (
                    <LiquidPositionCard key={l.id} preset={l.id as LiquidPreset} ls={s.liquid[l.id]} data={l.data} apr={l.apr} readOnly={s.readOnly} account={account} epoch={epoch} price={price} onDone={onLiquidDone} />
                  ) : null,
                )}
              {/* a balance that couldn't be read is said so, never silently left out */}
              {liquid.map((l) =>
                l.state === "error" ? (
                  <p key={l.id} className="text-sm text-muted">
                    {l.label}: couldn&apos;t read this account&apos;s balance right now ({l.error}).
                  </p>
                ) : null,
              )}
            </div>
          </section>
        )}

        <aside aria-label="Your account and rates" className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {on && <Available readOnly={mode !== "mine"} spendable={spendable.data} error={spendable.error} price={price} onCashOutState={reloadSpendable} />}
          <Rates title={sum.staked > 0n ? "Other ways to earn" : "Ways to earn"} nativeApr={stats.data?.apr} nativeError={!!stats.error} epoch={epoch} now={now} liquid={liquid.map((l, i) => ({ id: l.id, apr: l.apr, aprLoading: liquidApr.data === undefined, price: liquidPool.data?.[i]?.ok ? liquidPool.data[i].value.price : undefined }))} />
        </aside>

        <div className={`min-w-0 lg:col-start-1 ${on ? "lg:row-start-2" : "lg:row-start-1"}`}>{activity}</div>
      </div>
    </>
  );
}

function HeroLine({ staked, yearly, apr, partialApr, price }: { staked: bigint; yearly: bigint | null; apr: number | null; partialApr: boolean; price: number | null }) {
  if (staked === 0n) return <p className="mt-2 text-base text-muted">Nothing staked yet.</p>;
  const usd = usdText(staked, price);
  return (
    <p className="mt-2 text-base text-muted">
      {usd}
      {usd && yearly !== null && (
        <span aria-hidden className="mx-2">
          ·
        </span>
      )}
      {yearly !== null && (
        <>
          <span className="font-medium text-accent">+≈{smallNear(yearly)} / year</span> at {partialApr ? "about " : ""}
          {percent(apr)} APR
        </>
      )}
    </p>
  );
}

/** Under the hero figure when nothing earns but NEAR is still in pools: what it waits for. */
function UnstakedLine({ ready, unstaking, price, unlockIn }: { ready: bigint; unstaking: bigint; price: number | null; unlockIn: string | null }) {
  const usd = usdText(ready + unstaking, price);
  const what =
    unstaking === 0n
      ? "Unlocked and not earning: withdraw it to the account."
      : ready === 0n
        ? `Not earning while it unlocks${unlockIn ? `, first unlock in ${unlockIn}` : ""}.`
        : `${formatNear(ready)} ready to withdraw, ${formatNear(unstaking)} still unlocking. Not earning.`;
  return (
    <p className="mt-2 text-base text-muted">
      {usd && (
        <>
          {usd}
          <span aria-hidden className="mx-2">
            ·
          </span>
        </>
      )}
      {what}
    </p>
  );
}

function Cell({ label, value, hint, quiet = false, accent = false }: { label: string; value: string | undefined; hint: string; quiet?: boolean; accent?: boolean }) {
  return (
    <div>
      <p className="flex min-h-6 items-center text-[13px] text-muted">{label}</p>
      {value === undefined ? <Skeleton className="mt-1 h-7 w-28" /> : <p className={`mt-1 text-lg font-semibold tabular-nums sm:text-xl ${quiet ? "text-muted" : accent ? "text-accent" : ""}`}>{value}</p>}
      <p className="mt-1 text-[13px] text-muted">{hint}</p>
    </div>
  );
}

function ConnectHero() {
  const { connectNear, connecting } = useApp();
  return (
    <section aria-labelledby="connect-h" className="rounded-3xl border border-line bg-panel p-5 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0 max-w-2xl">
          <p className="text-sm font-medium text-muted">Your portfolio</p>
          <h2 id="connect-h" className="mt-2 text-2xl font-semibold sm:text-3xl">
            Connect a NEAR wallet to see your stake
          </h2>
          <p className="mt-2 text-muted">Positions, unstaking countdowns and the NEAR on your account show up here.</p>
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
          <button type="button" onClick={() => void connectNear()} disabled={connecting} className="btn-tactile-accent h-14 justify-center px-7 text-base">
            {connecting ? "Connecting…" : "Connect NEAR wallet"}
          </button>
          <Link href="/portfolio?view=demo" className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-accent hover:underline">
            View a demo account
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The NEAR on the account that is not staked, why it is there, and the way out to any chain. */
function Available({ readOnly, spendable, error, price, onCashOutState }: { readOnly: boolean; spendable: bigint | undefined; error: string; price: number | null; onCashOutState: () => void }) {
  const { near } = useApp();
  const [open, setOpen] = useState(false);
  // a sent cash-out stays mounted (hidden) while 1Click works, so its status keeps updating
  const [inFlight, setInFlight] = useState(false);
  const onInFlight = useCallback(
    (v: boolean) => {
      setInFlight(v);
      if (!v) onCashOutState();
    },
    [onCashOutState],
  );
  const usd = spendable !== undefined ? usdText(spendable, price) : null;
  return (
    <section aria-labelledby="avail-h" className="rounded-[20px] border border-line bg-panel p-6">
      <h2 id="avail-h" className="text-sm font-medium text-muted">
        {readOnly ? "Available on this account" : "Available on your account"}
      </h2>
      {spendable !== undefined ? (
        <p className="mt-2 text-[28px] font-semibold leading-9 tabular-nums">{formatNear(spendable)}</p>
      ) : error ? (
        <p className="mt-2 text-sm text-muted">Couldn&apos;t read the balance right now.</p>
      ) : (
        <Skeleton className="mt-2 h-9 w-36" />
      )}
      {spendable !== undefined && <p className="mt-1 text-sm text-muted">{usd ? `${usd} · not staked` : "Not staked"}</p>}
      <p className="mt-4 text-sm text-muted">
        {spendable === undefined || spendable <= RESERVE_LIKE
          ? "Kept back when you staked: a gas reserve so you can unstake later, plus gas refunded after the stake. Yours to use any time."
          : `Not staked, so it isn't earning. Yours to use any time; a cash-out keeps ${formatNear(DEFAULT_RESERVE, 2)} for the gas of a later unstake.`}
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={readOnly || (spendable === 0n && !inFlight)}
        aria-describedby={readOnly ? "avail-ro" : undefined}
        className="btn-tactile mt-5 min-h-11 w-full justify-center px-5 text-[15px] font-medium"
      >
        {inFlight && !open ? "Cash-out on its way: show it" : "Cash out to any chain"}
        <ArrowRightIcon />
      </button>
      {readOnly && (
        <p id="avail-ro" className="mt-2 text-center text-[13px] text-muted">
          {near ? "Demo account: show your own account to cash out." : "Demo account: connect a wallet to cash out."}
        </p>
      )}
      {!readOnly && (open || inFlight) && (
        <Modal title="Cash out to any chain" open={open} onClose={() => setOpen(false)} wide>
          <WithdrawOut onInFlight={onInFlight} />
        </Modal>
      )}
    </section>
  );
}

function Rates({
  title,
  nativeApr,
  nativeError,
  epoch,
  now,
  liquid,
}: {
  title: string;
  nativeApr: number | undefined;
  nativeError: boolean;
  epoch: NearEpoch | undefined;
  now: number;
  liquid: { id: LiquidPreset; apr: number | null; aprLoading: boolean; price: bigint | undefined }[];
}) {
  const h = epoch ? Math.max(1, Math.round((unbondingWindow(epoch).at - now) / 3_600_000)) : null;
  const rate = (v: number | null | undefined, loading: boolean) => (v !== null && v !== undefined ? percent(v) : loading ? <Skeleton className="ml-auto h-5 w-12" /> : "—");
  const rows: { key: string; disc: string; discClass: string; name: string; hint: ReactNode; rate: ReactNode; basis: string }[] = [
    { key: "native", disc: "N", discClass: "bg-accent", name: "Validator pools", hint: `Native · ${h !== null ? `~${h} h` : "21–28 h"} to unlock`, rate: rate(nativeApr, !nativeError), basis: "before pool fee" },
    ...liquid.map((l) => {
      const o = LIQUID_OPTIONS.find((x) => x.id === l.id)!;
      return {
        key: l.id,
        disc: l.id === "rnear" ? "r" : "Li",
        discClass: "bg-liquid",
        name: l.id === "rnear" ? "rNEAR by Rhea" : "LiNEAR",
        hint: <span className="font-mono text-xs">{l.price !== undefined ? `1 ${o.symbol} = ${formatUnits(l.price, 24, 4)} NEAR` : `${o.symbol} token`}</span>,
        rate: rate(l.apr, l.aprLoading),
        basis: "last 7 days",
      };
    }),
  ];
  return (
    <section aria-labelledby="rates-h" className="rounded-[20px] border border-line bg-panel px-6 pb-4 pt-6">
      <h2 id="rates-h" className="text-base font-semibold">
        {title}
      </h2>
      <p className="mt-1 text-[13px] text-muted">Today&apos;s rates. Pick one when you stake.</p>
      <ul className="mt-4">
        {rows.map((r) => (
          <li key={r.key} className="border-t border-line">
            <Link href="/stake" className="-mx-2 flex items-center gap-3 rounded-[14px] px-2 py-3 transition-colors hover:bg-surface">
              <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-bold text-accent-ink ${r.discClass}`}>
                {r.disc}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium leading-[22px]">{r.name}</span>
                <span className="block text-[13px] leading-5 text-muted">{r.hint}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[15px] font-semibold leading-[22px] tabular-nums">{r.rate}</span>
                <span className="block text-xs leading-5 text-muted">{r.basis}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mb-2 mt-2 border-t border-line pt-3 text-[13px] text-muted">rNEAR and LiNEAR are tokens: swap them any time instead of waiting for an unlock.</p>
    </section>
  );
}

export { refusalText, shortAccount };
