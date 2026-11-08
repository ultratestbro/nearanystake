"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { KNOWN_MINIMUM_USD, MEMO_CHAINS, type SourceAsset } from "@/lib/assets";
import { depositAddressToShow } from "@/lib/dryrun";
import { clock, dateTime, formatUnits, plainUnits } from "@/lib/format";
import { addressInactiveAt, quoteDeadline } from "@/lib/oneclick/quote";
import type { QuoteResponse } from "@/lib/oneclick/types";
import type { Payer } from "@/lib/pay";
import { useNow } from "@/lib/useAsync";
import { Disclosure } from "./Disclosure";
import { CTA, Notice } from "./StakeCard";

/**
 * The one-time deposit: pay from a connected wallet, or send it by hand to the address (with QR and
 * memo). Renders nothing payable in dry-run mode or for a dry quote, nor within `cutoffMs` of the
 * deadline (a deposit 1Click sees after it is refunded, minus the refund fee).
 *
 * `variant="cta"` is the quote card's primary action: the Pay (or connect) button and the time left,
 * without the manual address (that one is shown in the tracker, where the status is polled).
 */
export function DepositPanel({
  quote,
  dryRun,
  asset,
  payer,
  onConnectPayer,
  connecting,
  cutoffMs,
  onPaid,
  variant = "full",
}: {
  quote: QuoteResponse;
  dryRun: boolean;
  asset: SourceAsset;
  payer: Payer | null;
  onConnectPayer: (() => void) | null;
  connecting: boolean;
  /** Paying stops this long before the deadline. */
  cutoffMs: number;
  /** The parent locks the panel away after this: a second payment would be refunded minus the fee. */
  onPaid: (txHash: string) => void;
  variant?: "full" | "cta";
}) {
  const address = depositAddressToShow(quote, dryRun);
  const memo = quote.quote.depositMemo ?? null;
  const amount = BigInt(quote.quote.amountIn);
  const deadline = quoteDeadline(quote);
  const now = useNow(1000);
  const [qr, setQr] = useState("");
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState("");
  // open by default only when there is no wallet to pay from
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);

  useEffect(() => {
    if (!address) return;
    const scheme = asset.chain.startsWith("bitcoin:") ? "bitcoin" : null;
    const text = scheme && !asset.contract ? `${scheme}:${address}?amount=${plainUnits(amount, asset.decimals)}` : address;
    QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#111111", light: "#ffffff" } }).then(setQr, () => setQr(""));
  }, [address, asset, amount]);

  if (!address)
    return (
      <Notice title="Dry run">No deposit address is ever shown in dry-run mode. Connect a NEAR wallet and switch to Live to get one.</Notice>
    );

  const left = deadline !== null ? deadline - now : null;
  if (left !== null && left <= cutoffMs)
    return (
      <Notice tone="attention" title={left > 0 ? "Too close to the deadline" : "The deadline passed"}>
        {left > 0 ? `Only ${clock(left)} left: a deposit sent now may reach 1Click after the refund begins.` : "A deposit now would be refunded (minus the refund fee)."} Don&apos;t send to this
        address: start a new quote instead.
      </Notice>
    );
  const pay = async () => {
    if (!payer || paying) return;
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
      return;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/reject|denied|cancel/i.test(m) ? "You cancelled in the wallet." : m);
    } finally {
      setPaying(false);
    }
  };

  const urgent = left !== null && left - cutoffMs < 5 * 60_000;
  const action = payer ? (
    <button type="button" onClick={() => void pay()} disabled={paying} className={CTA}>
      {paying ? "Confirm in your wallet…" : `Pay ${formatUnits(amount, asset.decimals)} ${asset.symbol} from ${payer.label}`}
    </button>
  ) : (
    onConnectPayer && (
      <button type="button" onClick={onConnectPayer} disabled={connecting} className={variant === "cta" ? CTA : "btn-tactile min-h-12 w-full justify-center px-4 font-medium"}>
        {connecting ? "Connecting…" : `Connect a ${asset.chainLabel} wallet to pay`}
      </button>
    )
  );
  const error = err && (
    <p role="alert" className="text-sm text-danger">
      {err}
    </p>
  );

  if (variant === "cta")
    return (
      <div className="flex flex-col gap-2">
        {action}
        {error}
        {left !== null && (
          <p className={`text-center text-[13px] leading-5 ${urgent ? "text-danger" : "text-muted"}`}>
            Pay within <span className="font-mono tabular-nums">{clock(left - cutoffMs)}</span>
          </p>
        )}
      </div>
    );

  const refundFee = quote.quote.refundFee ? BigInt(quote.quote.refundFee) : null;
  const inactiveAt = addressInactiveAt(quote);
  return (
    <div className="flex flex-col gap-3">
      {left !== null && (
        <div className={`flex items-center justify-between rounded-xl px-4 py-2.5 text-sm ${urgent ? "bg-danger/10 text-danger" : "bg-surface"}`}>
          <span>Pay within</span>
          <span className="font-mono tabular-nums">{clock(left - cutoffMs)}</span>
        </div>
      )}
      {action}
      {error}
      <Disclosure summary="Or send it yourself" open={manualOpen ?? !payer} onOpenChange={setManualOpen} bodyClassName="flex flex-col gap-3 text-sm">
        <p>
          Send <b>exactly</b> this amount on <b>{asset.chainLabel}</b>, <b>once</b>. Any wallet works; refunds go to your refund address.
        </p>
        {qr && <div className="mx-auto w-44 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />}
        <Field label="Amount" value={`${plainUnits(amount, asset.decimals)} ${asset.symbol}`} copy={plainUnits(amount, asset.decimals)} />
        <Field label="One-time deposit address" value={address} copy={address} mono />
        {deadline !== null && (
          <p className="text-xs leading-5 text-muted">
            {`Refund deadline ${dateTime(deadline)}: a deposit after it is refunded, minus the refund fee.`}
            {inactiveAt !== null && inactiveAt > deadline ? ` The address goes inactive later, at ${dateTime(inactiveAt)}: never send to it after that.` : ""}
          </p>
        )}
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
        <ExchangeWarnings asset={asset} memo={memo} refundFee={refundFee !== null ? `${formatUnits(refundFee, asset.decimals)} ${asset.symbol}` : null} />
      </Disclosure>
    </div>
  );
}

function ExchangeWarnings({ asset, memo, refundFee }: { asset: SourceAsset; memo: string | null; refundFee: string | null }) {
  return (
    <Disclosure variant="plain" summary={<span className="font-medium text-warn">Sending from an exchange?</span>}>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-5 text-muted">
        <li>The refund address must be your own wallet: a refund sent to an exchange deposit address can be lost.</li>
        <li>Exchanges often subtract their withdrawal fee. Less than the quoted amount arrives and the swap waits for a top-up (INCOMPLETE_DEPOSIT) or is refunded at the deadline.</li>
        {(memo || MEMO_CHAINS.has(asset.chain)) && <li>{asset.chainLabel} deposits may need a memo, and many exchanges can&apos;t add one.</li>}
        {KNOWN_MINIMUM_USD[asset.chain] && <li>{asset.chainLabel} currently has a ${KNOWN_MINIMUM_USD[asset.chain]} minimum per swap.</li>}
        <li>{refundFee ? `A refund costs ${refundFee}.` : "Refunds cost the refund fee."}</li>
      </ul>
    </Disclosure>
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
        className="btn-tactile min-h-9 shrink-0 px-3 text-xs"
      >
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        <span className="sr-only"> {label.toLowerCase()}</span>
      </button>
    </div>
  );
}
