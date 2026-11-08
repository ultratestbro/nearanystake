"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { addRecord, newId } from "@/lib/history";
import { dateTime, duration, formatNear, formatUnits, parseUnits, percent, shortAccount } from "@/lib/format";
import {
  LIQUID_OPTIONS, UNSTAKED_DUST, refusalText, stakingErrorText,
  type LiquidPreset, type LiquidStaking, type NativeStaking, type NearClaimQuote, type NearPoolPosition, type NearUnstakeQuote, type LiquidUnstakeQuote, type LiquidClaimQuote, type UnlockEstimate,
} from "@/lib/staking";
import { useAsync, useNow } from "@/lib/useAsync";
import { useApp } from "./AppProvider";
import { EpochClock } from "./EpochClock";
import { useAccountStaking } from "./hooks";
import { Modal } from "./Modal";
import { TxLink } from "./TxLink";
import { TxPreview } from "./TxPreview";
import { WithdrawOut } from "./WithdrawOut";
import { Banner, Panel, Pill, PillTabs, Row, Rows, Skeleton, Spinner } from "./ui";

const WARN_TEXT: Record<string, string> = {
  "pool-fee-above-max": "fee raised above 10 %",
  "pool-paused": "pool paused",
  "pool-leaving-set": "leaving the validator set",
  "pool-not-in-set": "not validating",
};

export function Positions() {
  const params = useSearchParams();
  const { near, demoId } = useApp();
  const [view, setView] = useState<"mine" | "demo">(params.get("view") === "demo" ? "demo" : "mine");
  const effective = view === "mine" && near ? "mine" : "demo";
  const s = useAccountStaking(effective);
  // getStakedBalance, not listPositions: when the pool lookup is down it still shows the known pools and says so
  const balance = useAsync(() => s.native.getStakedBalance(), [s], 60_000);
  const positions = { ...balance, data: balance.data?.positions };
  const accountId = s.accountId ?? demoId;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold sm:text-3xl">Positions</h1>
          <p className="truncate text-muted">
            <span className="font-mono">{accountId}</span> {s.readOnly && <Pill tone="warn">read-only demo</Pill>}
          </p>
        </div>
        <PillTabs
          tabs={[
            { id: "mine", label: near ? "My account" : "My account (connect)" },
            { id: "demo", label: `Demo: ${demoId}` },
          ]}
          value={effective}
          onChange={(v) => setView(v)}
        />
      </div>
      {view === "mine" && !near && <Banner title="Connect a NEAR wallet to see your own positions">Meanwhile this shows a public delegator&apos;s account, read-only.</Banner>}
      {effective === "demo" && (
        <Banner title="Demo account">
          A public delegator picked because it has NEAR unbonding: you can see the epoch countdown and preflight unstake and withdraw. Nothing can be signed for it.
        </Banner>
      )}

      <EpochClock />

      <Panel className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Validator pools</h2>
          <ClaimAll native={s.native} readOnly={s.readOnly} positions={positions.data ?? []} onDone={positions.reload} account={accountId} />
        </div>
        {positions.error && <p className="text-sm text-danger">{positions.error}</p>}
        {balance.data?.partial && (
          <Banner tone="warn" title="Pool lookup is down">
            fastnear&apos;s index didn&apos;t answer, so only pools this app already knows are shown. Stake elsewhere is safe; it shows up again once the lookup is back.
          </Banner>
        )}
        {!positions.data && !positions.error && <Skeleton className="h-28 w-full" />}
        {positions.data?.length === 0 && <p className="text-sm text-muted">No native stake on this account yet.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {positions.data?.map((p) => <PositionCard key={p.pool} p={p} native={s.native} readOnly={s.readOnly} account={accountId} onDone={positions.reload} />)}
        </div>
      </Panel>

      <Panel className="flex flex-col gap-4 p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Liquid staking</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {LIQUID_OPTIONS.map((o) => (
            <LiquidCard key={o.id} preset={o.id} ls={s.liquid[o.id]} readOnly={s.readOnly} account={accountId} />
          ))}
        </div>
      </Panel>

      {effective === "mine" && near && <WithdrawOut />}
    </div>
  );
}

function UnlockLine({ u }: { u: UnlockEstimate }) {
  const now = useNow(30_000);
  const to = u.at ?? u.earliestAt;
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span>
        {to > now ? `Unlocks in ${duration(to - now)}` : "Unlocking at the next epoch boundary"}
        {u.latestAt && u.latestAt !== to ? ` – ${duration(Math.max(0, u.latestAt - now))}` : ""}
      </span>
      <span className="text-xs text-muted">
        epoch {u.epoch !== null ? u.epoch.toString() : `${u.earliestEpoch.toString()}${u.latestEpoch !== null && u.latestEpoch !== u.earliestEpoch ? `–${u.latestEpoch.toString()}` : "+"}`} · {dateTime(to)}
        {u.latestAt && u.latestAt !== to ? ` to ${dateTime(u.latestAt)}` : ""} · {u.source === "history" ? "dated from your last unstake" : u.source === "contract" ? "from the contract" : "estimate: the pool only says “not yet”"}
      </span>
    </div>
  );
}

function PositionCard({ p, native, readOnly, account, onDone }: { p: NearPoolPosition; native: NativeStaking; readOnly: boolean; account: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{p.pool}</p>
          <p className="text-xs text-muted">
            {p.poolInfo?.feePercent !== null && p.poolInfo?.feePercent !== undefined ? `${percent(p.poolInfo.feePercent, 0)} fee · ` : ""}
            {p.poolInfo?.apr !== null && p.poolInfo?.apr !== undefined ? `${percent(p.poolInfo.apr)} APR` : ""}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {p.warnings.map((w) => (
            <Pill key={w} tone="warn">
              {WARN_TEXT[w] ?? w}
            </Pill>
          ))}
        </div>
      </div>
      <Rows>
        <Row label="Staked">{formatNear(p.staked)}</Row>
        <Row label="Unstaked">{formatNear(p.unstaked)}</Row>
        <Row label="Withdrawable">{p.withdrawable > 0n ? <span className="text-accent">{formatNear(p.withdrawable)}</span> : "0 NEAR"}</Row>
      </Rows>
      {p.unlock && <UnlockLine u={p.unlock} />}
      <div className="flex flex-wrap gap-2">
        {/* rounding dust left staked is not worth an unstake: it would restart the unlock timer of everything unstaking here */}
        <button type="button" onClick={() => setOpen(true)} disabled={p.staked < UNSTAKED_DUST} title={p.staked > 0n && p.staked < UNSTAKED_DUST ? "Only rounding dust is staked here" : undefined} className="btn-tactile px-3.5 py-2 text-sm font-medium">
          Unstake
        </button>
      </div>
      {open && <UnstakeModal pool={p.pool} staked={p.staked} position={p} native={native} readOnly={readOnly} account={account} onClose={() => setOpen(false)} onDone={onDone} />}
    </div>
  );
}

function UnstakeModal({ pool, staked, position, native, readOnly, account, onClose, onDone }: { pool: string; staked: bigint; position: NearPoolPosition; native: NativeStaking; readOnly: boolean; account: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [all, setAll] = useState(true);
  // the module refuses to restart a running unbonding wait unless the user says so here
  const [allowTimerReset, setAllowTimerReset] = useState(false);
  const [q, setQ] = useState<NearUnstakeQuote | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState("");
  const amount = all ? ("all" as const) : parseUnits(text, 24);

  const preflight = async () => {
    setErr("");
    setQ(null);
    if (amount === null) return setErr("Enter an amount.");
    setBusy(true);
    try {
      setQ(await native.quoteRequestWithdrawal({ amount, pool, allowTimerReset }));
    } catch (e) {
      setErr(stakingErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const sign = async () => {
    if (!q || amount === null) return;
    setBusy(true);
    setErr("");
    try {
      const r = await native.requestWithdrawal({ amount, pool, allowTimerReset, expected: q.transactions });
      setHash(r.hash);
      addRecord({ id: newId(), type: "action", kind: "unstake", createdAt: Date.now(), account, target: pool, amount: q.amount.toString(), txs: r.hashes.map((h) => ({ chain: "near:mainnet", hash: h, label: "Unstake" })) });
      onDone();
    } catch (e) {
      setErr(stakingErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Unstake from ${pool.replace(/\.(poolv1|pool)\.near$/, "")}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <button type="button" aria-pressed={all} onClick={() => setAll(true)} className="btn-tactile px-3 py-1.5 text-sm">
            All ({formatNear(staked, 3)})
          </button>
          <button type="button" aria-pressed={!all} onClick={() => setAll(false)} className="btn-tactile px-3 py-1.5 text-sm">
            Amount
          </button>
        </div>
        {!all && <input value={text} onChange={(e) => setText(e.target.value)} placeholder="NEAR" inputMode="decimal" className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-accent" />}
        {position.unstaked > 0n && !position.canWithdraw && (
          <Banner tone="warn" title="This restarts your unbonding timer">
            {formatNear(position.unstaked)} is already unbonding here. A new unstake makes all of it wait 4 more epochs (~21–28 h from now). Usually better: wait until it unlocks, withdraw it,
            then unstake.
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowTimerReset}
                onChange={(e) => {
                  setAllowTimerReset(e.target.checked);
                  setQ(null);
                }}
                className="mt-1 accent-[var(--accent)]"
              />
              <span>Restart the wait for the {formatNear(position.unstaked, 3)} too</span>
            </label>
          </Banner>
        )}
        {position.unstaked > 0n && position.canWithdraw && (
          <Banner tone="accent" title="Your unlocked NEAR is withdrawn first">
            {formatNear(position.unstaked)} is ready: it is withdrawn in the same transaction, so it doesn&apos;t lock again.
          </Banner>
        )}
        {q && (
          <>
            <TxPreview transactions={q.transactions} />
            <Rows>
              <Row label="Unstaking">{formatNear(q.amount)}</Row>
              {q.withdrawsFirst > 0n && <Row label="Withdrawn first">{formatNear(q.withdrawsFirst)}</Row>}
              <Row label="Unlocks">
                epoch {q.unlock.earliestEpoch.toString()}
                {q.unlock.latestEpoch !== null ? `–${q.unlock.latestEpoch.toString()}` : "+"}
                <span className="block text-xs text-muted">
                  {dateTime(q.unlock.earliestAt)}
                  {q.unlock.latestAt ? ` – ${dateTime(q.unlock.latestAt)}` : ""}
                </span>
              </Row>
              <Row label="Network fee" hint={`${formatNear(q.upfront, 4)} held back for gas while it runs, refunded`}>at most {formatNear(q.fee, 5)}</Row>
            </Rows>
            {q.warnings.map((w) => (
              <p key={w.code} className="text-sm text-warn">
                {w.message}
              </p>
            ))}
          </>
        )}
        {err && <p className="text-sm text-danger">{err}</p>}
        {hash ? (
          <Banner tone="accent" title="Unstake sent">
            <TxLink chain="near:mainnet" hash={hash} />
          </Banner>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void preflight()} disabled={busy} className="btn-tactile justify-center px-4 py-2.5 text-sm font-medium">
              {busy && !q ? <Spinner /> : "Preflight"}
            </button>
            <button type="button" onClick={() => void sign()} disabled={busy || !q || readOnly} title={readOnly ? "Read-only demo account" : undefined} className="btn-tactile-accent justify-center px-4 py-2.5 text-sm">
              Sign unstake
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ClaimAll({ native, readOnly, positions, onDone, account }: { native: NativeStaking; readOnly: boolean; positions: NearPoolPosition[]; onDone: () => void; account: string }) {
  const ready = positions.filter((p) => p.withdrawable > 0n);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState<NearClaimQuote | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hashes, setHashes] = useState<string[]>([]);
  const locked = positions.filter((p) => p.unstaked > 0n && !p.canWithdraw);

  const preflight = async () => {
    setErr("");
    setBusy(true);
    try {
      setQ(await native.quoteClaimWithdrawals());
    } catch (e) {
      setErr(stakingErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!ready.length && !locked.length) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void preflight();
        }}
        className={ready.length ? "btn-tactile-accent px-3.5 py-2 text-sm" : "btn-tactile px-3.5 py-2 text-sm font-medium"}>
        {ready.length ? `Withdraw ${formatNear(ready.reduce((s, p) => s + p.withdrawable, 0n), 3)}` : "Withdraw"}
      </button>
      {open && (
        <Modal title="Withdraw unstaked NEAR" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-3">
            {busy && !q && <Spinner />}
            {q && (
              <>
                <TxPreview transactions={q.transactions} />
                <Rows>
                  <Row label="To your account">{formatNear(q.amount)}</Row>
                  <Row label="Network fee" hint={`${formatNear(q.upfront, 4)} held back for gas while it runs, refunded`}>at most {formatNear(q.fee, 5)}</Row>
                </Rows>
              </>
            )}
            {err && <Banner tone="warn" title="Not withdrawable yet">{err}</Banner>}
            {hashes.length ? (
              <Banner tone="accent" title="Withdrawn">
                {hashes.map((h) => (
                  <TxLink key={h} chain="near:mainnet" hash={h} />
                ))}{" "}
                Next: send it to any chain below.
              </Banner>
            ) : (
              <button
                type="button"
                disabled={!q || readOnly || busy}
                onClick={async () => {
                  if (!q) return;
                  setBusy(true);
                  try {
                    const r = await native.claimWithdrawals({ expected: q.transactions });
                    setHashes(r.hashes);
                    addRecord({ id: newId(), type: "action", kind: "claim", createdAt: Date.now(), account, target: q.claims.map((c) => c.pool).join(", "), amount: q.amount.toString(), txs: r.hashes.map((h) => ({ chain: "near:mainnet", hash: h, label: "Withdraw" })) });
                    onDone();
                  } catch (e) {
                    setErr(stakingErrorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                className="btn-tactile-accent justify-center px-4 py-2.5 text-sm"
              >
                {readOnly ? "Read-only demo account" : q && q.transactions.length > 1 ? `Sign ${q.transactions.length} withdrawals (one prompt)` : "Sign withdrawal"}
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function LiquidCard({ preset, ls, readOnly, account }: { preset: LiquidPreset; ls: LiquidStaking; readOnly: boolean; account: string }) {
  const o = LIQUID_OPTIONS.find((x) => x.id === preset)!;
  const data = useAsync(() => Promise.all([ls.getAccountDetails(), ls.getWithdrawalRequests(), ls.getPoolInfo()]), [ls], 60_000);
  const [modal, setModal] = useState<"unstake" | "claim" | null>(null);
  if (data.error) return <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">{o.label}: {data.error}</div>;
  if (!data.data) return <Skeleton className="h-40 w-full" />;
  const [d, w, info] = data.data;
  const req = w.requests[0];
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{o.label}</p>
          <p className="text-xs text-muted">{o.contract}</p>
        </div>
        {info.paused ? <Pill tone="danger">paused</Pill> : !info.codeHashKnown ? <Pill tone="danger">unknown code</Pill> : <Pill tone="liquid">1 {o.symbol} = {formatUnits(info.price, 24, 4)} NEAR</Pill>}
      </div>
      <Rows>
        <Row label="Balance">
          {formatUnits(d.shares, 24, 4)} {o.symbol}
          <span className="block text-xs text-muted">≈ {formatNear(d.value)}</span>
        </Row>
        <Row label="Unstaked">{formatNear(d.unstaked)}</Row>
      </Rows>
      {req && req.unlock && <UnlockLine u={req.unlock} />}
      {req?.awaitingLiquidity && <p className="text-sm text-warn">Unlocked, waiting for the protocol&apos;s payout (the contract refills after its epoch bot runs).</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setModal("unstake")} disabled={d.shares === 0n} className="btn-tactile px-3.5 py-2 text-sm font-medium">
          Unstake
        </button>
        <button type="button" onClick={() => setModal("claim")} disabled={!req} className={req?.claimable ? "btn-tactile-accent px-3.5 py-2 text-sm" : "btn-tactile px-3.5 py-2 text-sm font-medium"}>
          Withdraw
        </button>
      </div>
      {modal && <LiquidModal kind={modal} ls={ls} symbol={o.symbol} shares={d.shares} readOnly={readOnly} account={account} onClose={() => setModal(null)} onDone={data.reload} />}
    </div>
  );
}

function LiquidModal({ kind, ls, symbol, shares, readOnly, account, onClose, onDone }: { kind: "unstake" | "claim"; ls: LiquidStaking; symbol: string; shares: bigint; readOnly: boolean; account: string; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState<LiquidUnstakeQuote | LiquidClaimQuote | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState("");
  // set only after the module refused a timer reset and the user agreed to it
  const [allowTimerReset, setAllowTimerReset] = useState(false);
  const [resetRefused, setResetRefused] = useState(false);
  useEffect(() => {
    (kind === "unstake" ? ls.quoteRequestWithdrawal({ amount: "all", allowTimerReset }) : ls.quoteClaimWithdrawals()).then(setQ, (e: unknown) => {
      setResetRefused((e as { code?: string })?.code === "timer-reset-refused");
      setErr(stakingErrorText(e));
    });
  }, [kind, ls, allowTimerReset]);
  const sign = async () => {
    if (!q) return;
    setBusy(true);
    try {
      const r = kind === "unstake" ? await ls.requestWithdrawal({ amount: "all", allowTimerReset, expected: q.transactions }) : await ls.claimWithdrawals({ expected: q.transactions });
      setHash(r.hash);
      addRecord({ id: newId(), type: "action", kind: kind === "unstake" ? "unstake" : "claim", createdAt: Date.now(), account, target: symbol, amount: q.amount.toString(), txs: [{ chain: "near:mainnet", hash: r.hash, label: kind }] });
      onDone();
    } catch (e) {
      setErr(stakingErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={kind === "unstake" ? `Unstake all ${symbol}` : `Withdraw from ${symbol}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {kind === "unstake" && <p className="text-sm text-muted">Burns {formatUnits(shares, 24, 4)} {symbol}. Unlocks in at least 4 epochs (≈ 21–35 h or more); the contract may add more. The exact epoch shows here after the unstake.</p>}
        {!q && !err && <Spinner />}
        {q && (
          <>
            <TxPreview transactions={q.transactions} />
            <Rows>
              <Row label={kind === "unstake" ? "NEAR unstaking" : "To your account"}>{formatNear(q.amount)}</Row>
              <Row label="Network fee" hint={`${formatNear(q.upfront, 4)} held back for gas while it runs, refunded`}>at most {formatNear(q.fee, 5)}</Row>
            </Rows>
            {"warnings" in q && q.warnings.map((w) => <p key={w.code} className="text-sm text-warn">{w.message}</p>)}
          </>
        )}
        {err && <Banner tone="warn">{err}</Banner>}
        {kind === "unstake" && resetRefused && !allowTimerReset && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowTimerReset}
              onChange={(e) => {
                setErr("");
                setQ(null);
                setAllowTimerReset(e.target.checked);
              }}
              className="mt-1 accent-[var(--accent)]"
            />
            <span>Unstake anyway and restart the wait for what is already unbonding</span>
          </label>
        )}
        {hash ? (
          <Banner tone="accent" title="Sent">
            <TxLink chain="near:mainnet" hash={hash} />
          </Banner>
        ) : (
          <button type="button" onClick={() => void sign()} disabled={!q || readOnly || busy} className="btn-tactile-accent justify-center px-4 py-2.5 text-sm">
            {readOnly ? "Read-only demo account" : busy ? "Confirm in your wallet…" : "Sign"}
          </button>
        )}
      </div>
    </Modal>
  );
}

export { refusalText, shortAccount };
