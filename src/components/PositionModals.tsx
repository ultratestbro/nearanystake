"use client";

// The Portfolio's write dialogs: unstake and withdraw, native and liquid. Every quote, check and
// write is the staking module's; a dialog only shows the quote, asks for the timer-reset consent
// the module requires, and signs exactly the quoted transactions (`expected`).

import { useEffect, useState } from "react";
import { addRecord, newId } from "@/lib/history";
import { dateTime, formatNear, formatUnits, parseUnits } from "@/lib/format";
import { poolName } from "@/lib/portfolio";
import { claimFirst, stakingErrorText, warningText, type LiquidClaimQuote, type LiquidStaking, type LiquidUnstakeQuote, type NativeStaking, type NearClaimQuote, type NearPoolPosition, type NearUnstakeQuote } from "@/lib/staking";
import { Modal } from "./Modal";
import { TxLink } from "./TxLink";
import { TxPreview } from "./TxPreview";
import { Banner, Row, Rows, Spinner } from "./ui";

const READ_ONLY = "Read-only demo account";

export function UnstakeModal({ pool, staked, position, native, readOnly, account, onClose, onDone }: { pool: string; staked: bigint; position: NearPoolPosition; native: NativeStaking; readOnly: boolean; account: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [all, setAll] = useState(true);
  // the module refuses to restart a running unbonding wait unless the user says so here
  const [allowTimerReset, setAllowTimerReset] = useState(false);
  const [q, setQ] = useState<NearUnstakeQuote | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState("");
  // 'claim-first': the unlocked balance has to be withdrawn on its own before this unstake fits the account's gas
  const [claim, setClaim] = useState<{ id: bigint; withdrawable: bigint } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const amount = all ? ("all" as const) : parseUnits(text, 24);
  // a preview is for the amount it was made for: any edit drops it (the write would refuse it anyway)
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setQ(null);
  };

  const preflight = async () => {
    setErr("");
    setQ(null);
    setClaim(null);
    setClaimed(false);
    if (amount === null) return setErr("Enter an amount.");
    setBusy(true);
    try {
      setQ(await native.quoteRequestWithdrawal({ amount, pool, allowTimerReset }));
    } catch (e) {
      setClaim(claimFirst(e));
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
      setClaim(claimFirst(e));
      setErr(stakingErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Unstake from ${poolName(pool)}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div role="group" aria-label="How much to unstake" className="flex gap-2">
          <button type="button" aria-pressed={all} onClick={() => edit(setAll)(true)} className="btn-tactile min-h-11 px-4 text-sm font-medium">
            All ({formatNear(staked, 3)})
          </button>
          <button type="button" aria-pressed={!all} onClick={() => edit(setAll)(false)} className="btn-tactile min-h-11 px-4 text-sm font-medium">
            Amount
          </button>
        </div>
        {!all && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted">NEAR to unstake</span>
            <input value={text} onChange={(e) => edit(setText)(e.target.value)} placeholder="0.0" inputMode="decimal" className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-accent" />
          </label>
        )}
        {position.unstaked > 0n && !position.canWithdraw && (
          <Banner tone="warn" title="This restarts your unstaking wait">
            {formatNear(position.unstaked)} is already unstaking here. A new unstake makes all of it wait 4 more epochs (about 21–28 h from now). Usually better: wait
            until it unlocks, withdraw it, then unstake.
            <label className="mt-2 flex min-h-11 items-start gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={allowTimerReset}
                onChange={(e) => {
                  setAllowTimerReset(e.target.checked);
                  setQ(null);
                }}
                className="mt-1 size-4 accent-[var(--accent)]"
              />
              <span>Restart the wait for the {formatNear(position.unstaked, 3)} too</span>
            </label>
          </Banner>
        )}
        {position.unstaked > 0n && position.canWithdraw && !claim && (
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
                {q.unlock ? (
                  <>
                    epoch {q.unlock.earliestEpoch.toString()}
                    {q.unlock.latestEpoch !== null ? `–${q.unlock.latestEpoch.toString()}` : "+"}
                    <span className="block text-xs text-muted">
                      {dateTime(q.unlock.earliestAt)}
                      {q.unlock.latestAt ? ` – ${dateTime(q.unlock.latestAt)}` : ""}
                    </span>
                  </>
                ) : (
                  <>
                    Unlock time unknown
                    <span className="block text-xs text-muted">The epoch couldn&apos;t be read right now. Unstaked NEAR unlocks 4 epochs later (about 21–28 h).</span>
                  </>
                )}
              </Row>
              <Row label="Network fee" hint={`${formatNear(q.upfront, 4)} held back for gas while it runs, refunded`}>
                at most {formatNear(q.fee, 5)}
              </Row>
            </Rows>
            {q.warnings.map((w) => (
              <p key={w.code} className="text-sm text-warn">
                {warningText(w)}
              </p>
            ))}
          </>
        )}
        {claim ? (
          <Banner tone="warn" title="Withdraw the unlocked NEAR first">
            {err}
            <button type="button" onClick={() => setClaiming(true)} className="btn-tactile-accent mt-3 min-h-11 w-full justify-center px-4 text-sm">
              Withdraw {formatNear(claim.withdrawable, 3)} first
            </button>
          </Banner>
        ) : (
          err && <p className="text-sm text-danger">{err}</p>
        )}
        {claim && claiming && (
          <ClaimModal
            native={native}
            id={claim.id}
            readOnly={readOnly}
            account={account}
            onClose={() => {
              setClaiming(false);
              // withdrawn: the unstake now needs one call's gas, and Preview builds it again
              if (claimed) {
                setClaim(null);
                setErr("");
              }
            }}
            onDone={() => {
              setClaimed(true);
              onDone();
            }}
          />
        )}
        {hash ? (
          <Banner tone="accent" title="Unstake sent">
            <TxLink chain="near:mainnet" hash={hash} /> It shows as Unstaking on the card, with its unlock time.
          </Banner>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void preflight()} disabled={busy} className="btn-tactile min-h-11 justify-center px-4 text-sm font-medium">
              {busy && !q ? <Spinner /> : q ? "Check again" : "Preview"}
            </button>
            <button type="button" onClick={() => void sign()} disabled={busy || !q || readOnly} title={readOnly ? READ_ONLY : !q ? "Preview the transaction first" : undefined} className="btn-tactile-accent min-h-11 justify-center px-4 text-sm">
              {readOnly ? "Read-only" : busy && q ? "Confirm in your wallet…" : "Sign unstake"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Withdraws every unlocked native balance (one `withdraw_all` per pool, one prompt), or only request
 * `id` (one pool's, when an unstake needs it withdrawn first); quoted as it opens.
 */
export function ClaimModal({ native, id, readOnly, account, onClose, onDone }: { native: NativeStaking; id?: bigint; readOnly: boolean; account: string; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState<NearClaimQuote | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const [hashes, setHashes] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    native.quoteClaimWithdrawals(id !== undefined ? { ids: [id] } : undefined).then(
      (r) => live && setQ(r),
      (e: unknown) => live && setErr(stakingErrorText(e)),
    ).finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [native, id]);

  const sign = async () => {
    if (!q) return;
    setBusy(true);
    try {
      const r = await native.claimWithdrawals({ ...(id !== undefined ? { ids: [id] } : {}), expected: q.transactions });
      setHashes(r.hashes);
      addRecord({ id: newId(), type: "action", kind: "claim", createdAt: Date.now(), account, target: q.claims.map((c) => c.pool).join(", "), amount: q.amount.toString(), txs: r.hashes.map((h) => ({ chain: "near:mainnet", hash: h, label: "Withdraw" })) });
      onDone();
    } catch (e) {
      setErr(stakingErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Withdraw unlocked NEAR" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {busy && !q && <Spinner />}
        {q && (
          <>
            <TxPreview transactions={q.transactions} />
            {q.claims.length > 1 && <p className="text-sm text-muted">This withdraws the unlocked NEAR of every pool, in one approval.</p>}
            <Rows>
              {q.claims.length > 1 && q.claims.map((c) => <Row key={c.pool} label={`From ${poolName(c.pool)}`}>{formatNear(c.amount)}</Row>)}
              <Row label="To your account">{formatNear(q.amount)}</Row>
              <Row label="Network fee" hint={`${formatNear(q.upfront, 4)} held back for gas while it runs, refunded`}>
                at most {formatNear(q.fee, 5)}
              </Row>
            </Rows>
          </>
        )}
        {err && (
          <Banner tone="warn" title="Not withdrawable yet">
            {err}
          </Banner>
        )}
        {hashes.length ? (
          <Banner tone="accent" title="Withdrawn">
            {hashes.map((h) => (
              <TxLink key={h} chain="near:mainnet" hash={h} />
            ))}{" "}
            It is on your account now: cash it out to any chain from &ldquo;Available on your account&rdquo;.
          </Banner>
        ) : (
          <button type="button" disabled={!q || readOnly || busy} onClick={() => void sign()} className="btn-tactile-accent min-h-11 justify-center px-4 text-sm">
            {readOnly ? READ_ONLY : busy && q ? "Confirm in your wallet…" : q && q.transactions.length > 1 ? `Sign ${q.transactions.length} withdrawals (one prompt)` : "Sign withdrawal"}
          </button>
        )}
      </div>
    </Modal>
  );
}

export function LiquidModal({ kind, ls, symbol, shares, readOnly, account, onClose, onDone }: { kind: "unstake" | "claim"; ls: LiquidStaking; symbol: string; shares: bigint; readOnly: boolean; account: string; onClose: () => void; onDone: () => void }) {
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
        {kind === "unstake" && (
          <p className="text-sm text-muted">
            Burns {formatUnits(shares, 24, 4)} {symbol}. The NEAR unlocks after at least 4 epochs (about 21–35 h, sometimes more); the exact epoch shows on the card after
            the unstake. Swapping the token is the instant way out.
          </p>
        )}
        {!q && !err && <Spinner />}
        {q && (
          <>
            <TxPreview transactions={q.transactions} />
            <Rows>
              <Row label={kind === "unstake" ? "NEAR unstaking" : "To your account"}>{formatNear(q.amount)}</Row>
              <Row label="Network fee" hint={`${formatNear(q.upfront, 4)} held back for gas while it runs, refunded`}>
                at most {formatNear(q.fee, 5)}
              </Row>
            </Rows>
            {"warnings" in q &&
              q.warnings.map((w) => (
                <p key={w.code} className="text-sm text-warn">
                  {warningText(w)}
                </p>
              ))}
          </>
        )}
        {err && <Banner tone="warn">{err}</Banner>}
        {kind === "unstake" && resetRefused && !allowTimerReset && (
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowTimerReset}
              onChange={(e) => {
                setErr("");
                setQ(null);
                setAllowTimerReset(e.target.checked);
              }}
              className="mt-1 size-4 accent-[var(--accent)]"
            />
            <span>Unstake anyway and restart the wait for what is already unstaking</span>
          </label>
        )}
        {hash ? (
          <Banner tone="accent" title="Sent">
            <TxLink chain="near:mainnet" hash={hash} />
          </Banner>
        ) : (
          <button type="button" onClick={() => void sign()} disabled={!q || readOnly || busy} className="btn-tactile-accent min-h-11 justify-center px-4 text-sm">
            {readOnly ? READ_ONLY : busy ? "Confirm in your wallet…" : "Sign"}
          </button>
        )}
      </div>
    </Modal>
  );
}
