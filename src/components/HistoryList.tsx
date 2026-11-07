"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadHistory, onHistory, type HistoryRecord } from "@/lib/history";
import { ago, formatNear, formatUnits, shortAccount } from "@/lib/format";
import { TxLink } from "./TxLink";
import { Banner, Pill } from "./ui";

const KIND: Record<string, string> = {
  "stake-in": "Stake from another chain",
  "instant-stnear": "Instant stNEAR",
  "withdraw-out": "Withdraw to another chain",
  stake: "Stake",
  unstake: "Unstake",
  claim: "Withdraw",
};

export function HistoryList() {
  const [items, setItems] = useState<HistoryRecord[] | null>(null);
  useEffect(() => {
    const read = () => setItems(loadHistory());
    read();
    return onHistory(read);
  }, []);
  if (items === null) return null;
  if (!items.length)
    return (
      <Banner title="Nothing here yet">
        Quotes (dry or live), deposits, stakes, unstakes and withdrawals you make in this browser are listed here with explorer links. <Link href="/stake" className="underline">Start staking</Link>.
      </Banner>
    );
  return (
    <ul className="flex flex-col gap-3">
      {items.map((r) => (
        <li key={r.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {KIND[r.kind]} {r.type === "flow" ? `→ ${r.targetLabel}` : `· ${r.target}`}
            </p>
            <span className="flex items-center gap-2 text-xs text-muted">
              {r.type === "flow" && r.dry && <Pill tone="warn">dry run</Pill>}
              {r.type === "flow" && r.status && <Pill tone={r.status === "SUCCESS" ? "accent" : r.status === "REFUNDED" || r.status === "FAILED" ? "danger" : "muted"}>{r.status}</Pill>}
              {ago(r.createdAt)}
            </span>
          </div>
          {r.type === "flow" ? (
            <p className="text-sm text-muted">
              {formatUnits(BigInt(r.quote.quote.amountIn), r.source.decimals)} {r.source.symbol} on {r.source.chainLabel} → ≈ {r.quote.quote.amountOutFormatted.slice(0, 10)} · account {shortAccount(r.account)}
              {r.staked && ` · staked ${formatNear(BigInt(r.staked))}`}
            </p>
          ) : (
            <p className="text-sm text-muted">
              {formatNear(BigInt(r.amount))} · {shortAccount(r.account)}
            </p>
          )}
          {r.txs.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {r.txs.map((t) => (
                <span key={t.hash}>
                  {t.label}: <TxLink chain={t.chain} hash={t.hash} />
                </span>
              ))}
            </div>
          )}
          {r.type === "flow" && (
            <div className="flex flex-wrap items-center gap-2">
              {!r.dry && r.kind !== "withdraw-out" && (
                <Link href={`/stake?flow=${r.id}`} className="btn-tactile px-3 py-1.5 text-xs font-medium">
                  Open status
                </Link>
              )}
              <details className="min-w-0 flex-1 text-xs">
                <summary className="cursor-pointer text-muted">Signed quote (keep for disputes)</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">{JSON.stringify(r.quote, null, 2)}</pre>
              </details>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
