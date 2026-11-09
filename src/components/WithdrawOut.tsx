"use client";

import { useEffect, useState } from "react";
import { DESTINATION_ASSETS, PINNED_CHAINS, findAsset, looksLikeAddress, type SourceAsset } from "@/lib/assets";
import { addRecord, newId, updateFlow } from "@/lib/history";
import { nearClient, nearSpendable } from "@/lib/near/reads";
import { getStatus, requestQuote, submitDepositTx } from "@/lib/oneclick/client";
import { buildOutboundQuoteRequest, payCutoffMs, quoteDeadline } from "@/lib/oneclick/quote";
import { isFinal, phaseOf } from "@/lib/oneclick/status";
import type { QuoteResponse, StatusResponse } from "@/lib/oneclick/types";
import { connectPayer, PAYER_LABEL } from "@/lib/pay";
import { clock, formatNear, formatUnits, parseUnits, plainUnits, shortAccount } from "@/lib/format";
import { exitReserve, nativeStaking, upfrontGas, type NativeStaking } from "@/lib/staking";
import { useAsync, useNow } from "@/lib/useAsync";
import { useApp } from "./AppProvider";
import { PayWithSheet } from "./PayWithSheet";
import { TxLink } from "./TxLink";
import { TxPreview } from "./TxPreview";
import { ChevronDownIcon } from "./icons";
import { Banner, Icon, Row, Rows } from "./ui";

const WNEAR = "wrap.near";
const STORAGE = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR: NEP-145 registration on wrap.near (refunded if already registered)
const TGAS = 10n ** 12n;

/** The NEAR-side deposit 1Click expects: wrap NEAR and transfer the wNEAR to the one-time address, in one transaction. */
export function outboundDepositTx(account: string, depositAddress: string, amount: bigint) {
  const fc = (methodName: string, args: Record<string, unknown>, deposit: bigint) => ({ functionCall: { methodName, args, gas: 30n * TGAS, deposit } });
  return {
    receiverId: WNEAR,
    actions: [
      fc("storage_deposit", { account_id: account, registration_only: true }, STORAGE),
      fc("near_deposit", {}, amount),
      fc("storage_deposit", { account_id: depositAddress, registration_only: true }, STORAGE),
      fc("ft_transfer", { receiver_id: depositAddress, amount: amount.toString() }, 1n),
    ],
  };
}

/** A 1Click deposit address on NEAR (64 hex) for sizing the transaction before a quote exists. */
const PROBE_ADDRESS = "0".repeat(64);

/**
 * What can leave: spendable − the wNEAR transaction's upfront gas (120 Tgas bought at
 * min_gas_purchase_price, refunded after) − two registrations − the reserve a stake also keeps, so
 * the account can still pay a later unstake (the staking module's largest exit).
 */
async function sendable(account: string, staking: NativeStaking): Promise<{ max: bigint; reserve: bigint }> {
  const rpc = nearClient().rpc;
  const [free, upfront, reserve] = await Promise.all([nearSpendable(account, rpc), upfrontGas(rpc, [outboundDepositTx(account, PROBE_ADDRESS, 1n)]), exitReserve(staking, rpc)]);
  const max = free - upfront - 2n * STORAGE - reserve - 1n;
  return { max: max > 0n ? max : 0n, reserve };
}

/**
 * "Cash out to any chain": NEAR on the account → 1Click → a token on another chain, to the user's own
 * address. Shown in a dialog; `onInFlight` says when a deposit is being signed or 1Click is still
 * working on a sent one, so the dialog can stay mounted (hidden) and keep tracking it.
 */
export function WithdrawOut({ onInFlight }: { onInFlight?: (inFlight: boolean) => void } = {}) {
  const { near, dryRun } = useApp();
  const account = near!.accountId;
  const signer = near!.account;
  const bal = useAsync(() => sendable(account, nativeStaking(signer)), [account, signer], 30_000);
  const spendable = bal.data?.max ?? 0n;
  const [dest, setDest] = useState<SourceAsset | null>(() => findAsset("eip155:8453", "USDC") ?? null);
  const [sheet, setSheet] = useState(false);
  const [text, setText] = useState("");
  const [recipient, setRecipient] = useState("");
  const [own, setOwn] = useState(false);
  // the quote keeps the token it was made for: what is shown and signed is the quote, never the edited inputs
  const [quote, setQuote] = useState<{ res: QuoteResponse; flowId: string; dest: SourceAsset } | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [hash, setHash] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);
  const amount = parseUnits(text, 24);

  const deadline = quote ? quoteDeadline(quote.res) : null;
  const phase = phaseOf(status, { deadlineMs: deadline, now });
  const cutoff = payCutoffMs("near:mainnet");
  const sent = !!hash;
  const inFlight = (sent && !isFinal(phase)) || (busy && !!quote && !sent);
  useEffect(() => {
    onInFlight?.(inFlight);
  }, [inFlight, onInFlight]);

  // any edit makes the quote stale: drop it (after sending, the inputs are locked instead)
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    if (sent) return;
    set(v);
    setQuote(null);
    setStatus(null);
  };

  // until 1Click gives a final answer; once a minute past the deadline, in case it saw the deposit late
  useEffect(() => {
    if (!quote || quote.res.quoteRequest.dry || !hash || isFinal(phase)) return;
    const t = setInterval(async () => {
      const s = await getStatus(quote.res.quote.depositAddress!).catch(() => null);
      if (s) {
        setStatus(s);
        updateFlow(quote.flowId, { status: s.status });
      }
    }, phase === "expired" ? 60_000 : 5000);
    return () => clearInterval(t);
  }, [quote, hash, phase]);

  const fromWallet = async () => {
    if (!dest?.family) return;
    try {
      const p = await connectPayer(dest.family);
      edit(setRecipient)(p.address);
      setOwn(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const getQuote = async () => {
    setErr("");
    setQuote(null);
    setHash("");
    setStatus(null);
    if (!dest) return;
    if (amount === null || amount <= 0n) return setErr("Enter an amount of NEAR.");
    if (amount > spendable)
      return setErr(
        `At most ${formatNear(spendable)} can leave: NEAR holds back about 0.12 NEAR of prepaid gas while the transaction runs (refunded), plus the wNEAR registrations and ${bal.data ? formatNear(bal.data.reserve, 3) : "a reserve"} kept for the gas of a later unstake.`,
      );
    if (!looksLikeAddress(dest.chain, recipient)) return setErr(`Enter your own ${dest.chainLabel} address.`);
    if (!own) return setErr("Confirm the address is your own wallet.");
    setBusy(true);
    try {
      const req = buildOutboundQuoteRequest({ destinationAsset: dest.assetId, amount, recipient: recipient.trim(), refundTo: account, dry: dryRun });
      const res = await requestQuote(req, { dryRun, direction: "outbound" });
      const quoted = dest;
      const flowId = newId();
      addRecord({
        id: flowId,
        type: "flow",
        kind: "withdraw-out",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dry: req.dry,
        account,
        target: dest.assetId,
        targetLabel: `${dest.symbol} on ${dest.chainLabel}`,
        source: { chain: "near:mainnet", chainLabel: "NEAR", symbol: "NEAR", decimals: 24 },
        quote: res,
        status: null,
        staked: null,
        txs: [],
      });
      setQuote({ res, flowId, dest: quoted });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!quote || quote.res.quoteRequest.dry || !quote.res.quote.depositAddress || busy || sent) return;
    setBusy(true);
    setErr("");
    try {
      const r = await near!.account.sendTransaction(outboundDepositTx(account, quote.res.quote.depositAddress, BigInt(quote.res.quote.amountIn)));
      setHash(r.hash);
      updateFlow(quote.flowId, { addTx: { chain: "near:mainnet", hash: r.hash, label: "Deposit" } });
      void submitDepositTx({ txHash: r.hash, depositAddress: quote.res.quote.depositAddress, nearSenderAccount: account });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const live = quote && !quote.res.quoteRequest.dry && !dryRun ? quote.res : null;
  const field = "min-h-11 rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-accent disabled:opacity-60";
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Send NEAR from <span className="font-mono text-text">{shortAccount(account)}</span> to a token on another chain. NEAR Intents swaps it and delivers it to your own
        wallet there; a refund comes back to {shortAccount(account)}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex min-h-6 items-center justify-between gap-2 text-sm text-muted">
            <label htmlFor="cashout-amount">NEAR to send</label>
            {bal.data !== undefined ? (
              <button type="button" onClick={() => edit(setText)(plainUnits(spendable, 24, 6))} disabled={sent || spendable === 0n} className="rounded-md px-1 text-[13px] text-accent hover:underline disabled:text-muted disabled:no-underline">
                {formatNear(spendable, 3)} available
              </button>
            ) : (
              <span>…</span>
            )}
          </div>
          <input id="cashout-amount" value={text} onChange={(e) => edit(setText)(e.target.value)} disabled={sent} inputMode="decimal" placeholder="0.0" className={field} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span id="cashout-receive" className="flex min-h-6 items-center text-sm text-muted">
            Receive
          </span>
          <button type="button" aria-labelledby="cashout-receive cashout-token" onClick={() => setSheet(true)} disabled={sent} className="btn-tactile min-h-11 justify-between px-3 py-2.5 text-left">
            <span id="cashout-token" className="flex min-w-0 items-center gap-2">
              {dest && <Icon src={dest.icon} alt="" size={22} />}
              <span className="truncate">{dest ? `${dest.symbol} on ${dest.chainLabel}` : "Pick a token"}</span>
            </span>
            <ChevronDownIcon className="text-muted" />
          </button>
        </div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-muted">Your address on {dest?.chainLabel}</span>
        <input
          value={recipient}
          onChange={(e) => {
            edit(setRecipient)(e.target.value);
            // a ticked "my own wallet" vouched for the old address, not this one
            if (!sent) setOwn(false);
          }}
          disabled={sent} spellCheck={false} autoComplete="off" className={`${field} font-mono text-sm`} />
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {dest?.family && (
          <button type="button" onClick={() => void fromWallet()} disabled={sent} className="btn-tactile min-h-11 px-4 text-sm font-medium">
            Use my {PAYER_LABEL[dest.family]}
          </button>
        )}
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={own} onChange={(e) => edit(setOwn)(e.target.checked)} disabled={sent} className="size-4 accent-[var(--accent)]" />
          This is my own wallet (not an exchange)
        </label>
      </div>
      {err && <Banner tone="danger">{err}</Banner>}
      <button type="button" onClick={() => void getQuote()} disabled={busy || sent} className={`${quote ? "btn-tactile font-medium" : "btn-tactile-accent"} min-h-12 justify-center px-4`}>
        {busy && !quote ? "Getting a quote…" : quote ? "Get a new quote" : dryRun ? "Get a dry-run quote" : "Get quote"}
      </button>
      {quote && (
        <Rows>
          <Row label="You send">{formatNear(BigInt(quote.res.quote.amountIn))}</Row>
          <Row label="You receive">
            ≈ {formatUnits(BigInt(quote.res.quote.amountOut), quote.dest.decimals)} {quote.dest.symbol} on {quote.dest.chainLabel}
            <span className="block text-xs text-muted">
              at least {formatUnits(BigInt(quote.res.quote.minAmountOut), quote.dest.decimals)} · to {quote.res.quoteRequest.recipient}
            </span>
          </Row>
          <Row label="Quote check">
            <span className="text-accent">✓ echo matches</span>
            <span className="block text-xs text-muted">refunds to {shortAccount(account)}</span>
          </Row>
          {deadline !== null && <Row label="Deadline">{deadline > now ? clock(deadline - now) : "passed"}</Row>}
        </Rows>
      )}
      {quote && quote.res.quoteRequest.dry && (
        <Banner tone="warn" title="Dry run">
          This quote can&apos;t be paid. Switch to Live to get a deposit address.
        </Banner>
      )}
      {live && !hash && (
        <>
          <TxPreview transactions={[outboundDepositTx(account, live.quote.depositAddress!, BigInt(live.quote.amountIn))]} />
          <button type="button" onClick={() => void send()} disabled={busy || (deadline !== null && deadline - now <= cutoff)} className="btn-tactile-accent min-h-12 justify-center px-4">
            {busy ? "Confirm in your wallet…" : deadline !== null && deadline - now <= cutoff ? "Too close to the deadline: get a new quote" : "Sign and send NEAR"}
          </button>
        </>
      )}
      {hash && (
        <Banner
          tone={phase === "delivered" ? "accent" : phase === "refunded" || phase === "failed" || phase === "expired" ? "danger" : "muted"}
          title={
            phase === "delivered" ? "Delivered" : phase === "refunded" ? "Refunded to your NEAR account" : phase === "failed" ? "1Click reports the swap failed" : phase === "expired" ? "Deadline passed" : "On its way"
          }
        >
          NEAR deposit <TxLink chain="near:mainnet" hash={hash} />
          {status?.status ? ` · 1Click: ${status.status}` : ""}
          {!isFinal(phase) && phase !== "expired" && <span className="block text-sm">Safe to close: this keeps checking while Portfolio is open, and Recent activity shows the result.</span>}
          {phase === "expired" && <span className="block text-sm">1Click hasn&apos;t taken the deposit in time: it refunds to {shortAccount(account)}. This keeps checking once a minute.</span>}
          {phase === "failed" && <span className="block text-sm">Check {shortAccount(account)} for the refund; if nothing arrives, contact 1Click support with the deposit address (the signed quote is in Recent activity).</span>}
        </Banner>
      )}
      {sheet && (
        <PayWithSheet
          title="Receive on"
          sources={DESTINATION_ASSETS}
          pinned={PINNED_CHAINS}
          chain={dest?.chain ?? ""}
          symbol={dest?.symbol ?? ""}
          balances={new Map()}
          hint="1Click delivers the token to your address on that chain."
          onPick={(t) => {
            edit(setDest)(t as SourceAsset);
            setRecipient("");
            setOwn(false);
            setSheet(false);
          }}
          onClose={() => setSheet(false)}
        />
      )}
    </div>
  );
}
