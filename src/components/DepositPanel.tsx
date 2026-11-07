"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { MEMO_CHAINS, type SourceAsset } from "@/lib/assets";
import { depositAddressToShow } from "@/lib/dryrun";
import { clock, formatUnits, plainUnits } from "@/lib/format";
import { quoteDeadline } from "@/lib/oneclick/quote";
import type { QuoteResponse } from "@/lib/oneclick/types";
import type { Payer } from "@/lib/pay";
import { useNow } from "@/lib/useAsync";
import { Banner } from "./ui";

/**
 * The one-time deposit: pay from a connected wallet, or send it by hand to the address (with QR and
 * memo). Renders nothing payable in dry-run mode or for a dry quote.
 */
export function DepositPanel({
  quote,
  dryRun,
  asset,
  payer,
  onConnectPayer,
  connecting,
  onPaid,
}: {
  quote: QuoteResponse;
  dryRun: boolean;
  asset: SourceAsset;
  payer: Payer | null;
  onConnectPayer: (() => void) | null;
  connecting: boolean;
  onPaid: (txHash: string) => void;
}) {
  const address = depositAddressToShow(quote, dryRun);
  const memo = quote.quote.depositMemo ?? null;
  const amount = BigInt(quote.quote.amountIn);
  const deadline = quoteDeadline(quote);
  const now = useNow(1000);
  const [qr, setQr] = useState("");
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!address) return;
    const scheme = asset.chain.startsWith("bitcoin:") ? "bitcoin" : null;
    const text = scheme && !asset.contract ? `${scheme}:${address}?amount=${plainUnits(amount, asset.decimals)}` : address;
    QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#111111", light: "#ffffff" } }).then(setQr, () => setQr(""));
  }, [address, asset, amount]);

  if (!address) return <Banner title="Dry run">No deposit address is ever shown in dry-run mode. Connect a NEAR wallet and switch to Live to get one.</Banner>;

  const left = deadline !== null ? deadline - now : null;
  const pay = async () => {
    if (!payer) return;
    setErr("");
    setPaying(true);
    try {
      const hash = await payer.pay({
        chain: asset.chain,
        symbol: asset.symbol,
        contract: asset.contract,
        decimals: asset.decimals,
        amount: amount.toString(),
        to: address,
        memo,
        validUntilMs: deadline ?? Date.now() + 3_600_000,
      });
      onPaid(hash);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/reject|denied|cancel/i.test(m) ? "You cancelled in the wallet." : m);
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {left !== null && (
        <div className={`flex items-center justify-between rounded-xl px-4 py-2.5 text-sm ${left < 5 * 60_000 ? "bg-danger/10 text-danger" : "bg-surface-2"}`}>
          <span>{left > 0 ? "Deposit before the deadline" : "The deadline passed: a deposit now is refunded"}</span>
          <span className="font-mono tabular-nums">{left > 0 ? clock(left) : "00:00"}</span>
        </div>
      )}
      {payer ? (
        <button type="button" onClick={() => void pay()} disabled={paying || (left !== null && left <= 0)} className="btn-tactile-accent justify-center px-4 py-3">
          {paying ? "Confirm in your wallet…" : `Pay ${formatUnits(amount, asset.decimals)} ${asset.symbol} from ${payer.label}`}
        </button>
      ) : (
        onConnectPayer && (
          <button type="button" onClick={onConnectPayer} disabled={connecting} className="btn-tactile justify-center px-4 py-3 font-medium">
            {connecting ? "Connecting…" : `Connect a wallet on ${asset.chainLabel} to pay`}
          </button>
        )
      )}
      {err && <p className="text-sm text-danger">{err}</p>}
      <details className="rounded-xl bg-surface-2 p-4 text-sm" open={!payer}>
        <summary className="cursor-pointer font-medium">Or send it yourself</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p>
            Send <b>exactly</b> this amount on <b>{asset.chainLabel}</b>. Any wallet works; refunds go to your refund address.
          </p>
          {qr && <div className="mx-auto w-44 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />}
          <Field label="Amount" value={`${plainUnits(amount, asset.decimals)} ${asset.symbol}`} copy={plainUnits(amount, asset.decimals)} />
          <Field label="One-time deposit address" value={address} copy={address} mono />
          {memo && (
            <>
              <Field label="Memo / comment (required)" value={memo} copy={memo} mono />
              <p className="text-danger">Without this memo the deposit can&apos;t be matched and is refunded. Many exchanges can&apos;t add a memo.</p>
            </>
          )}
          {!memo && MEMO_CHAINS.has(asset.chain) && <p className="text-xs text-muted">This network sometimes needs a memo: if your wallet asks, the quote above has none.</p>}
          {asset.contract && (
            <p className="text-xs text-muted">
              Token contract: <span className="break-all font-mono">{asset.contract}</span>
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

function Field({ label, value, copy, mono }: { label: string; value: string; copy: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className={`break-all ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(copy);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="btn-tactile shrink-0 px-3 py-1 text-xs"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
