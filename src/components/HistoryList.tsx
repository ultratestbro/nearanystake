"use client";

// "Recent activity" on the Portfolio: every quote, payment, stake, unstake and withdrawal made in
// this browser (lib/history), newest first. A row says what happened and its state in plain words;
// opening it shows each transaction as a step with a labelled explorer link, what to do next, and
// the quote exactly as 1Click signed it (kept for disputes).

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { DESTINATION_ASSETS, findAsset } from "@/lib/assets";
import { NEAR_N_PATH } from "@/lib/brand";
import { ago, dateTime, shortAccount, shortHash } from "@/lib/format";
import { loadHistory, onHistory, type HistoryRecord, type TxRef } from "@/lib/history";
import { explorerTx } from "@/lib/near/config";
import { activityStatus, activitySubtitle, activityTitle, stepText } from "@/lib/portfolio";
import { useNow } from "@/lib/useAsync";
import { Disclosure } from "./Disclosure";
import { ArrowUpRightIcon, CheckIcon, ChevronDownIcon, InfoIcon } from "./icons";
import { InfoHint } from "./InfoHint";
import { StatusBadge } from "./StatusBadge";
import { Icon, Skeleton } from "./ui";

/** Rows shown before "Show all". */
const LIMIT = 5;

export function HistoryList() {
  const [items, setItems] = useState<HistoryRecord[] | null>(null);
  const [all, setAll] = useState(false);
  const now = useNow(60_000);
  useEffect(() => {
    const read = () => setItems(loadHistory());
    read();
    return onHistory(read);
  }, []);
  // /history redirects to #activity; the list renders after hydration, so the jump happens once it is there
  const ready = items !== null;
  useEffect(() => {
    if (ready && window.location.hash === "#activity") document.getElementById("activity")?.scrollIntoView();
  }, [ready]);

  const shown = items && !all ? items.slice(0, LIMIT) : items;
  return (
    <section id="activity" aria-labelledby="activity-h" className="scroll-mt-6">
      <div className="mb-2 flex min-h-11 items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <h2 id="activity-h" className="text-xl font-semibold">
            Recent activity
          </h2>
          <InfoHint label="Where this list comes from">Kept in this browser only, with each quote exactly as 1Click signed it: keep it for disputes.</InfoHint>
        </div>
        {items && items.length > LIMIT && (
          <button type="button" onClick={() => setAll(!all)} aria-expanded={all} className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">
            {all ? "Show fewer" : `Show all ${items.length}`}
          </button>
        )}
      </div>
      {!shown ? (
        <Skeleton className="h-24 w-full rounded-[20px]" />
      ) : shown.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line px-6 py-8 text-center">
          <p className="font-medium">Nothing here yet</p>
          <p className="mt-1 text-sm text-muted">Quotes, payments, stakes and withdrawals you make in this browser show up here, with explorer links.</p>
          <Link href="/stake" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">
            Start staking
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-panel">
          {shown.map((r, i) => (
            <ActivityRow key={r.id} r={r} now={now} defaultOpen={i === 0} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityRow({ r, now, defaultOpen }: { r: HistoryRecord; now: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const st = activityStatus(r, now);
  const badge = (
    <StatusBadge variant="plain" tone={st.tone} pulse={st.tone === "progress"} icon={st.tone === "success" ? <CheckIcon size={16} /> : undefined}>
      {st.label}
    </StatusBadge>
  );
  const time = ago(r.createdAt, now);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-surface sm:items-center sm:gap-4 sm:px-6 sm:py-5"
      >
        <Glyphs r={r} />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold leading-6 [overflow-wrap:anywhere]">{activityTitle(r)}</span>
          <span className="mt-0.5 block text-sm leading-5 text-muted [overflow-wrap:anywhere]">{activitySubtitle(r)}</span>
          {/* on phones the state sits under the text, so the title keeps the width */}
          <span className="mt-1.5 flex items-center gap-2 sm:hidden">
            {badge}
            <span className="text-[13px] text-muted">{time}</span>
          </span>
        </span>
        <span className="hidden shrink-0 text-right sm:block">
          {badge}
          <span className="mt-0.5 block text-[13px] leading-5 text-muted">{time}</span>
        </span>
        <ChevronDownIcon size={20} className={`text-muted motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={id} hidden={!open} className="px-4 pb-5 sm:pb-6 sm:pl-20 sm:pr-6">
        <Details r={r} label={st.label} />
      </div>
    </li>
  );
}

function Details({ r, label }: { r: HistoryRecord; label: string }) {
  const flow = r.type === "flow" ? r : null;
  const waiting = label === "Waiting for payment";
  const note = flow?.dry
    ? "Dry run: a real quote, nothing could be paid."
    : label === "Not paid"
      ? "Nothing was paid for this quote; its deadline has passed."
      : waiting
        ? "Waiting for a payment. Open its status to see the deposit details."
        : label === "In progress" && !r.txs.length
          ? "Paid from your wallet; waiting for 1Click to see the deposit."
          : null;
  return (
    <div className="flex flex-col gap-3">
      {r.txs.length > 0 && (
        <ol aria-label="Steps" className="flex flex-col">
          {r.txs.map((t) => {
            const s = stepText(r, t);
            return (
              <li key={t.hash} className="flex min-h-11 flex-wrap items-center gap-x-3 border-t border-line py-1">
                <CheckIcon className="text-accent" />
                <span className="min-w-0 flex-[1_1_12rem] text-sm">
                  {s.text}
                  {s.where && <span className="text-muted"> {s.where}</span>}
                </span>
                <ExplorerLink t={t} chainLabel={t.chain === "near:mainnet" ? "NEAR" : (flow?.source.chainLabel ?? "")} />
              </li>
            );
          })}
        </ol>
      )}
      {note && <p className="border-t border-line pt-3 text-sm text-muted">{note}</p>}
      {flow && !flow.dry && flow.kind === "stake-in" && flow.staked && (
        <div className="flex gap-3 rounded-[14px] bg-surface p-4">
          <InfoIcon size={20} className="text-muted" />
          <p className="text-sm text-muted">
            <span className="font-medium text-text">Why some NEAR wasn&apos;t staked:</span> it stays on your account as a gas reserve so you can unstake later, plus gas refunded
            after the stake. Cash it out any time.
          </p>
        </div>
      )}
      {flow && !flow.dry && flow.status === "REFUNDED" && (
        <p className="text-sm text-muted">
          Refunded to {flow.kind === "withdraw-out" ? shortAccount(flow.account) : `your ${flow.source.chainLabel} wallet ${shortAccount(String(flow.quote.quoteRequest.refundTo ?? ""))}`}.
        </p>
      )}
      {flow && !flow.dry && flow.status === "FAILED" && (
        <p className="text-sm text-muted">1Click reports the swap failed. Check your wallet for the refund; if nothing arrives, contact 1Click support with the signed quote below.</p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {flow && !flow.dry && flow.kind !== "withdraw-out" && (
          <Link href={`/stake?flow=${flow.id}`} className={label === "Needs your signature" ? "btn-tactile-accent min-h-11 px-4 text-sm" : "btn-tactile min-h-11 px-4 text-sm font-medium"}>
            {label === "Needs your signature" ? "Sign the stake" : "Open status"}
          </Link>
        )}
        <p className="text-xs text-muted">
          {dateTime(r.createdAt)} · <span className="font-mono">{shortAccount(r.account)}</span>
        </p>
      </div>
      {flow && (
        <Disclosure variant="plain" summary="Signed quote (keep for disputes)">
          <pre className="mt-1 max-h-64 overflow-auto rounded-xl bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">{JSON.stringify(flow.quote, null, 2)}</pre>
        </Disclosure>
      )}
    </div>
  );
}

function ExplorerLink({ t, chainLabel }: { t: TxRef; chainLabel: string }) {
  const simulated = t.hash.startsWith("simulated");
  const url = simulated ? null : explorerTx(t.chain, t.hash);
  const short = simulated ? "simulated" : shortHash(t.hash);
  if (!url)
    return (
      <span className="font-mono text-[13px] text-muted" title={t.hash}>
        {short}
      </span>
    );
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={t.hash}
      aria-label={`${t.label} transaction ${short}${chainLabel ? ` on the ${chainLabel} explorer` : ""} (opens in a new tab)`}
      className="inline-flex min-h-11 items-center gap-1 font-mono text-[13px] text-accent hover:underline"
    >
      {short}
      <ArrowUpRightIcon size={14} />
    </a>
  );
}

function NearDisc({ size }: { size: number }) {
  return (
    <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-full bg-accent">
      <svg viewBox="0 0 512 512" style={{ width: size * 0.5, height: size * 0.5 }} aria-hidden>
        <path d={NEAR_N_PATH} fill="var(--accent-ink)" />
      </svg>
    </span>
  );
}

function LiquidDisc({ size, label }: { size: number; label: string }) {
  return (
    <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-full bg-liquid text-xs font-bold text-accent-ink">
      {label}
    </span>
  );
}

/** What went in and what came out, as two overlapping coins. */
function Glyphs({ r }: { r: HistoryRecord }) {
  const target = r.target.replace(/^liquid:/, "");
  const liquid = target === "rnear" || target === "rNEAR" ? "r" : target === "linear" || target === "LiNEAR" ? "Li" : null;
  if (r.type === "action")
    return (
      <span aria-hidden className="grid size-10 shrink-0 place-items-center">
        {liquid ? <LiquidDisc size={32} label={liquid} /> : <NearDisc size={32} />}
      </span>
    );
  const token = (src: string | undefined, alt: string) => (src ? <Icon src={src} alt="" size={28} /> : <span className="grid size-7 place-items-center rounded-full bg-surface-2 text-xs font-semibold">{alt.slice(0, 1)}</span>);
  const first = r.kind === "withdraw-out" ? <NearDisc size={28} /> : token(findAsset(r.source.chain, r.source.symbol)?.icon, r.source.symbol);
  const second =
    r.kind === "withdraw-out" ? token(DESTINATION_ASSETS.find((a) => a.assetId === r.target)?.icon, r.targetLabel) : liquid ? <LiquidDisc size={28} label={liquid} /> : <NearDisc size={28} />;
  return (
    <span aria-hidden className="relative size-10 shrink-0">
      <span className="absolute left-0 top-0">{first}</span>
      <span className="absolute bottom-0 right-0 rounded-full shadow-[0_0_0_2px_var(--panel)]">{second}</span>
    </span>
  );
}
