"use client";

// The tracker's two views of one swap: the route strip (source → NEAR Intents → NEAR account → pool,
// each node with what is there) and the timed step list with done / current / next steps. States
// come from lib/oneclick/status.ts (fundsView); this file only draws them.

import type { ReactNode } from "react";
import { explorerTx } from "@/lib/near/config";
import { shortHash } from "@/lib/format";
import type { LegState } from "@/lib/oneclick/status";
import { ArrowUpRightIcon, CheckIcon } from "./icons";

export type StepState = LegState;

export interface RouteNode {
  id: string;
  icon: ReactNode;
  title: ReactNode;
  caption?: ReactNode;
  state: StepState;
  /** Account ids and hashes. */
  mono?: boolean;
}

const RING: Record<StepState, string> = {
  done: "",
  active: "outline-2 outline-offset-2 outline-dashed outline-warn",
  waiting: "outline-2 outline-offset-2 outline-dashed outline-warn",
  failed: "outline-2 outline-offset-2 outline-danger",
  todo: "opacity-60",
};

/** Source → NEAR Intents → account → pool, with what each holds. `label` reads the whole route. */
export function RouteStrip({ nodes, label }: { nodes: RouteNode[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex items-start gap-1 rounded-2xl bg-surface px-2 py-3 sm:gap-2 sm:p-4">
      {nodes.map((n, i) => (
        <div key={n.id} className={`flex min-w-0 items-start gap-1 sm:gap-2 ${i < nodes.length - 1 ? "flex-1" : "shrink-0"}`}>
          <div className="flex w-[64px] shrink-0 flex-col items-center text-center sm:w-[92px]">
            <span className={`grid size-8 place-items-center rounded-full ${RING[n.state]}`}>{n.icon}</span>
            {/* names wrap onto two lines on phones; an account id stays on one line, cut, with the full id on hover */}
            <span
              title={n.mono && typeof n.title === "string" ? n.title : undefined}
              className={`mt-2 w-full text-xs font-semibold leading-4 sm:text-[13px] ${n.mono ? "truncate font-mono text-[11px] sm:text-[13px]" : "line-clamp-2"}`}
            >
              {n.title}
            </span>
            {n.caption && <span className="w-full text-[11px] leading-4 text-muted sm:text-xs">{n.caption}</span>}
          </div>
          {i < nodes.length - 1 && <Track state={nodes[i + 1]!.state} />}
        </div>
      ))}
    </div>
  );
}

function Track({ state }: { state: StepState }) {
  const line =
    state === "done" ? "border-accent" : state === "active" || state === "waiting" ? "border-dashed border-warn" : state === "failed" ? "border-danger" : "border-line";
  return (
    <span aria-hidden className={`relative mt-[15px] h-0 min-w-2 flex-1 border-t-2 ${line}`}>
      {state === "active" && <span className="travel absolute -top-[5px] size-2 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />}
    </span>
  );
}

export interface TrackStep {
  id: string;
  state: StepState;
  /** Omitted when `body` draws its own heading (the stake box). */
  title?: ReactNode;
  detail?: ReactNode;
  /** When it finished, from the start of the swap ("0:21"). */
  time?: string | null;
  /** The step's controls (pay, sign) or notices, under the title. */
  body?: ReactNode;
  /** The body is a box with its own heading: the rail mark lines up with the box's first line. */
  boxed?: boolean;
}

const SR: Record<StepState, string> = { done: "Done: ", active: "In progress: ", waiting: "Your turn: ", failed: "Stopped: ", todo: "Next: " };

/** The steps of a swap on a rail of state marks; the current one is aria-current. */
export function StepList({ steps }: { steps: TrackStep[] }) {
  const current = steps.findIndex((s) => s.state === "active" || s.state === "waiting");
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const next = steps[i + 1];
        const boxed = s.boxed ?? (!s.title && !!s.body);
        const line =
          next?.state === "done" ? "bg-accent" : next?.state === "active" || next?.state === "waiting" ? "bg-warn" : next?.state === "failed" ? "bg-danger/70" : "bg-line";
        return (
          <li key={s.id} aria-current={i === current ? "step" : undefined} className="flex gap-3 sm:gap-4">
            <div aria-hidden className={`flex w-6 shrink-0 flex-col items-center ${boxed ? "pt-4" : ""}`}>
              <Mark state={s.state} />
              {!last && <span className={`my-1 w-0.5 flex-1 rounded-full ${line}`} />}
            </div>
            <div className={`flex min-w-0 flex-1 flex-col gap-3 ${last ? "" : "pb-6"}`}>
              {s.title && (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className={`text-[15px] leading-6 ${s.state === "todo" ? "font-medium text-muted" : s.state === "failed" ? "font-semibold text-danger" : "font-semibold"}`}>
                      <span className="sr-only">{SR[s.state]}</span>
                      {s.title}
                    </p>
                    {s.detail && <div className="text-[13px] leading-5 text-muted [overflow-wrap:anywhere]">{s.detail}</div>}
                  </div>
                  {s.time && <span className="shrink-0 font-mono text-xs leading-6 tabular-nums text-muted">{s.time}</span>}
                </div>
              )}
              {s.body}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Mark({ state }: { state: StepState }) {
  if (state === "done")
    return (
      <span className="grid size-6 place-items-center rounded-full bg-accent text-accent-ink">
        <CheckIcon size={14} />
      </span>
    );
  if (state === "active" || state === "waiting")
    return (
      <span className="grid size-6 place-items-center rounded-full border-2 border-warn">
        <span className={`size-2 rounded-full bg-warn ${state === "active" ? "motion-safe:animate-pulse" : ""}`} />
      </span>
    );
  if (state === "failed") return <span className="grid size-6 place-items-center rounded-full bg-danger text-xs font-bold text-bg">!</span>;
  return <span className="size-6 rounded-full border-2 border-line" />;
}

const EXPLORER_NAMES: Record<string, string> = {
  "basescan.org": "Basescan",
  "etherscan.io": "Etherscan",
  "optimistic.etherscan.io": "Etherscan",
  "arbiscan.io": "Arbiscan",
  "bscscan.com": "BscScan",
  "polygonscan.com": "PolygonScan",
  "snowtrace.io": "Snowtrace",
  "gnosisscan.io": "GnosisScan",
  "solscan.io": "Solscan",
  "tronscan.org": "Tronscan",
  "tonviewer.com": "Tonviewer",
  "nearblocks.io": "NearBlocks",
  "mempool.space": "mempool.space",
  "blockchair.com": "Blockchair",
};

/** A transaction link named after its explorer ("Basescan ↗"); the hash is its hover text. */
export function ExplorerLink({ chain, hash }: { chain: string; hash: string }) {
  if (hash.startsWith("simulated")) return <span>simulated tx</span>;
  const url = explorerTx(chain, hash);
  if (!url)
    return (
      <span className="font-mono" title={hash}>
        {shortHash(hash)}
      </span>
    );
  const host = new URL(url).hostname.replace(/^www\./, "");
  return (
    <a href={url} target="_blank" rel="noreferrer" title={hash} className="inline-flex items-center gap-1 whitespace-nowrap text-accent no-underline hover:underline">
      {EXPLORER_NAMES[host] ?? host}
      <ArrowUpRightIcon size={12} />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Two arrows crossing: the swap inside NEAR Intents. */
export function IntentsGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
    </svg>
  );
}
