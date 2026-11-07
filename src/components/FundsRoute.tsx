"use client";

import type { ReactNode } from "react";
import type { FundsView, Leg } from "@/lib/oneclick/status";

/** "Where your funds are now": the route at a glance, then each leg with its state. */
export function FundsRoute({ view, icons, extra }: { view: FundsView; icons?: Partial<Record<Leg["id"], ReactNode>>; extra?: Partial<Record<Leg["id"], ReactNode>> }) {
  const tone = view.tone === "good" ? "text-accent" : view.tone === "bad" ? "text-danger" : view.tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-line bg-bg p-4">
        <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">Where your funds are now</p>
        <p className={`mt-1 font-medium ${tone}`}>{view.headline}</p>
        <div className="mt-4 flex items-start">
          {view.legs.map((l, i) => (
            <div key={l.id} className={`flex min-w-0 items-start ${i < view.legs.length - 1 ? "flex-1" : ""}`}>
              <Node leg={l} icon={icons?.[l.id]} />
              {i < view.legs.length - 1 && <Track state={trackState(l, view.legs[i + 1]!)} />}
            </div>
          ))}
        </div>
      </div>
      <ol className="flex flex-col">
        {view.legs.map((l, i) => (
          <li key={l.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepIcon state={l.state} />
              {i < view.legs.length - 1 && <span className={`my-1 w-px flex-1 ${l.state === "done" ? "bg-accent/60" : "bg-line"}`} />}
            </div>
            <div className="flex min-w-0 flex-col pb-4">
              <span className={l.state === "todo" ? "text-muted" : l.state === "failed" ? "text-danger" : l.state === "active" ? "font-medium" : ""}>{l.label}</span>
              {l.hint && <span className="text-xs text-muted">{l.hint}</span>}
              {extra?.[l.id]}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function trackState(a: Leg, b: Leg): "idle" | "moving" | "done" | "failed" {
  if (b.state === "failed") return "failed";
  if (b.state === "done") return "done";
  if (b.state === "active" || b.state === "waiting" || (a.state === "active" && a.id !== "source")) return "moving";
  return "idle";
}

function Node({ leg, icon }: { leg: Leg; icon?: ReactNode }) {
  const ring = leg.state === "done" ? "ring-accent" : leg.state === "failed" ? "ring-danger" : leg.state === "active" || leg.state === "waiting" ? "ring-warn" : "ring-line";
  return (
    <div className="flex w-[58px] shrink-0 flex-col items-center gap-1.5 text-center sm:w-24">
      <span className={`grid size-9 place-items-center rounded-full bg-surface-2 text-xs font-semibold ring-2 ${ring}`}>{icon ?? leg.label.slice(0, 1)}</span>
      <span className="w-full truncate text-[11px] text-muted sm:text-xs">{leg.id === "intents" ? "NEAR Intents" : leg.id === "near" ? "Your account" : leg.id === "pool" ? "Staked" : "Source"}</span>
    </div>
  );
}

function Track({ state }: { state: "idle" | "moving" | "done" | "failed" }) {
  return (
    <div className="relative mt-[17px] h-0.5 min-w-2 flex-1 rounded-full bg-line">
      {state === "done" && <div className="absolute inset-0 rounded-full bg-accent" />}
      {state === "failed" && <div className="absolute inset-0 rounded-full bg-danger/70" />}
      {state === "moving" && <span className="travel absolute -top-[3px] size-2 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />}
    </div>
  );
}

function StepIcon({ state }: { state: Leg["state"] }) {
  if (state === "active") return <span aria-label="in progress" className="size-5 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" />;
  if (state === "waiting") return <span aria-label="waiting" className="grid size-5 shrink-0 place-items-center rounded-full bg-warn text-xs text-bg">!</span>;
  if (state === "done") return <span aria-label="done" className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-xs text-accent-ink">✓</span>;
  if (state === "failed") return <span aria-label="failed" className="grid size-5 shrink-0 place-items-center rounded-full bg-danger text-xs text-bg">!</span>;
  return <span aria-hidden className="size-5 shrink-0 rounded-full border-2 border-line" />;
}

/** Two arrows crossing: the swap inside NEAR Intents. */
export function IntentsGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h13l-3-3M20 17H7l3 3" />
    </svg>
  );
}
