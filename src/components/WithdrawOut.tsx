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
import { clock, formatNear, formatUnits, parseUnits, shortAccount } from "@/lib/format";
import { DEFAULT_RESERVE, upfrontGas } from "@/lib/staking";
import { useAsync, useNow } from "@/lib/useAsync";
import { useApp } from "./AppProvider";
import { PayWithSheet } from "./PayWithSheet";
import { TxLink } from "./TxLink";
import { TxPreview } from "./TxPreview";
import { Banner, Icon, Panel, Row, Rows } from "./ui";

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
 * min_gas_purchase_price, refunded after) − two registrations − the reserve kept for later gas.
 */
async function sendable(account: string): Promise<bigint> {
  const rpc = nearClient().rpc;
  const [free, upfront] = await Promise.all([nearSpendable(account, rpc), upfrontGas(rpc, [outboundDepositTx(account, PROBE_ADDRESS, 1n)])]);
  const max = free - upfront - 2n * STORAGE - DEFAULT_RESERVE - 1n;
  return max > 0n ? max : 0n;
}

/** "Withdraw to any chain": NEAR on the account → 1Click → a token on another chain, to the user's own address. */
export function WithdrawOut() {
  const { near, dryRun } = useApp();
  const account = near!.accountId;
  const bal = useAsync(() => sendable(account), [account], 30_000);
  const spendable = bal.data ?? 0n;
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
    if (amount > spendable) return setErr(`At most ${formatNear(spendable)} can leave: NEAR holds back about 0.12 NEAR of prepaid gas while the transaction runs (refunded), plus the wNEAR registrations and 0.02 NEAR for later gas.`);
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
  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold">Withdraw to any chain</h2>
        <p className="text-sm text-muted">After a withdrawal, send the NEAR on {shortAccount(account)} to a token on another chain: NEAR → NEAR Intents → your wallet there.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">NEAR to send · {bal.data !== undefined ? `${formatNear(spendable > 0n ? spendable : 0n, 3)} available` : "…"}</span>
          <input value={text} onChange={(e) => edit(setText)(e.target.value)} disabled={sent} inputMode="decimal" placeholder="0.0" className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-accent" />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">Receive</span>
          <button type="button" onClick={() => setSheet(true)} disabled={sent} className="btn-tactile justify-between px-3 py-2.5 text-left">
            <span className="flex items-center gap-2">
              {dest && <Icon src={dest.icon} alt="" size={22} />}
              {dest ? `${dest.symbol} on ${dest.chainLabel}` : "Pick a token"}
            </span>
            <span className="text-xs text-muted">Change</span>
          </button>
        </div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-muted">Your address on {dest?.chainLabel}</span>
        <input value={recipient} onChange={(e) => edit(setRecipient)(e.target.value)} disabled={sent} spellCheck={false} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-mono text-sm outline-none focus:border-accent" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        {dest?.family && (
          <button type="button" onClick={() => void fromWallet()} className="btn-tactile px-3.5 py-2 text-sm font-medium">
            Use my {PAYER_LABEL[dest.family]}
          </button>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={own} onChange={(e) => edit(setOwn)(e.target.checked)} disabled={sent} className="accent-[var(--accent)]" />
          This is my own wallet (not an exchange)
        </label>
      </div>
      {err && <Banner tone="danger">{err}</Banner>}
      <button type="button" onClick={() => void getQuote()} disabled={busy || sent} className="btn-tactile-accent justify-center px-4 py-3">
        {busy && !quote ? "Getting a quote…" : dryRun ? "Get a dry-run quote" : "Get quote"}
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
      {quote && quote.res.quoteRequest.dry && <Banner tone="warn" title="Dry run">This quote can&apos;t be paid. Switch to Live to get a deposit address.</Banner>}
      {live && !hash && (
        <>
          <TxPreview transactions={[outboundDepositTx(account, live.quote.depositAddress!, BigInt(live.quote.amountIn))]} />
          <button type="button" onClick={() => void send()} disabled={busy || (deadline !== null && deadline - now <= cutoff)} className="btn-tactile-accent justify-center px-4 py-3">
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
          {phase === "expired" && <span className="block text-sm">1Click hasn&apos;t taken the deposit in time: it refunds to {shortAccount(account)}. This keeps checking once a minute.</span>}
          {phase === "failed" && <span className="block text-sm">Check {shortAccount(account)} for the refund; if nothing arrives, contact 1Click support with the deposit address (the signed quote is in History).</span>}
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
    </Panel>
  );
}
