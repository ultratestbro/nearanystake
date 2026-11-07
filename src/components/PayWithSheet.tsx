"use client";

import { useMemo, useState } from "react";
import type { SourceAsset } from "@/lib/assets";
import { Modal } from "./Modal";
import { money } from "@/lib/format";
import { Icon } from "./ui";

const ALL = "all";

export interface Held {
  amount: string; // base units
  usd: number | null;
}

export const heldKey = (chain: string, symbol: string) => `${chain}|${symbol}`;

/**
 * "Pay with": a search field, a rail of networks (all, then the pinned ones, then those holding
 * something, then the rest) and the picked network's tokens, held first with their balances.
 */
export function PayWithSheet({
  sources,
  pinned,
  chain,
  symbol,
  balances,
  hint,
  title = "Pay with",
  onPick,
  onClose,
}: {
  sources: SourceAsset[];
  pinned: string[];
  chain: string;
  symbol: string;
  balances: Map<string, Held>;
  /** What happens after the pick: connect a wallet, or send it yourself. */
  hint: string;
  /** Sheet title ("Pay with", "Receive on"). */
  title?: string;
  onPick: (t: SourceAsset) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const networks = useMemo(() => {
    const seen = new Map<string, { chain: string; label: string; icon: string; usd: number; held: boolean }>();
    for (const s of sources) {
      const n = seen.get(s.chain) ?? { chain: s.chain, label: s.chainLabel, icon: s.chainIcon, usd: 0, held: false };
      const b = balances.get(heldKey(s.chain, s.symbol));
      if (b) {
        n.held = true;
        n.usd += b.usd ?? 0;
      }
      seen.set(s.chain, n);
    }
    const rank = (c: string) => (pinned.includes(c) ? pinned.indexOf(c) : pinned.length);
    return [...seen.values()].sort((a, b) => rank(a.chain) - rank(b.chain) || Number(b.held) - Number(a.held) || b.usd - a.usd);
  }, [sources, balances, pinned]);
  const anyHeld = balances.size > 0;
  // open on the picked token's network
  const [net, setNet] = useState(chain || (anyHeld ? ALL : (networks[0]?.chain ?? ALL)));

  const searching = q.trim().length > 0;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = searching
      ? sources.filter((t) => t.symbol.toLowerCase().includes(needle) || t.chainLabel.toLowerCase().includes(needle))
      : net === ALL
        ? sources.filter((t) => balances.has(heldKey(t.chain, t.symbol)))
        : sources.filter((t) => t.chain === net);
    const usd = (t: SourceAsset) => balances.get(heldKey(t.chain, t.symbol))?.usd ?? (balances.has(heldKey(t.chain, t.symbol)) ? 0 : -1);
    return [...list].sort((a, b) => usd(b) - usd(a));
  }, [sources, balances, q, net, searching]);
  const current = networks.find((n) => n.chain === net);
  const heading = searching ? "Search results" : net === ALL ? "Your tokens" : (current?.label ?? "");
  const headingUsd = searching ? null : net === ALL ? (anyHeld ? networks.reduce((s, n) => s + n.usd, 0) : null) : current?.held ? current.usd : null;
  const showNetwork = searching || net === ALL;

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tokens or networks"
          aria-label="Search tokens or networks"
          className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-accent"
        />
        <div className="-mx-5 flex h-[min(56dvh,480px)] border-y border-line sm:-mx-6">
          <div role="tablist" aria-label="Networks" className="no-scrollbar flex w-[68px] shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-line bg-bg py-3 sm:w-52 sm:items-stretch sm:gap-0.5 sm:px-2">
            {[{ chain: ALL, label: "All networks", icon: "", held: false }, ...networks].map((n) => {
              const active = !searching && n.chain === net;
              return (
                <button
                  key={n.chain}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={n.held ? `${n.label}, has balance` : n.label}
                  title={n.label}
                  onClick={() => {
                    setQ("");
                    setNet(n.chain);
                  }}
                  className={`relative flex size-[52px] shrink-0 items-center justify-center gap-2.5 rounded-2xl border transition sm:h-11 sm:w-full sm:justify-start sm:rounded-xl sm:px-2.5 ${active ? "border-accent/60 bg-accent/10" : "border-transparent hover:bg-surface"}`}
                >
                  {n.chain === ALL ? (
                    <span className="grid size-[30px] place-items-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted">ALL</span>
                  ) : (
                    <Icon src={n.icon} alt={n.label} size={30} />
                  )}
                  {/* the network's name on wider screens; phones keep the narrow rail of logos */}
                  <span className={`hidden min-w-0 flex-1 truncate text-left text-sm sm:block ${active ? "text-text" : "text-muted"}`}>{n.label}</span>
                  {n.held && <span className="absolute right-1.5 top-1.5 size-[7px] rounded-full bg-accent sm:static sm:shrink-0" />}
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-baseline justify-between gap-3 px-4 pb-1.5 pt-3.5">
              <p className="truncate font-medium">{heading}</p>
              {headingUsd !== null && <p className="shrink-0 text-xs tabular-nums text-muted">{money(headingUsd)}</p>}
            </div>
            <div className="flex-1 overflow-y-auto px-1.5 pb-4">
              {shown.length === 0 && (
                <p className="p-2.5 text-sm text-muted">
                  {searching
                    ? `Nothing matches “${q.trim()}”.`
                    : net === ALL
                      ? "Pick a network on the left, or search."
                      : "No tokens on this network."}
                </p>
              )}
              {shown.map((t) => {
                const b = balances.get(heldKey(t.chain, t.symbol));
                const selected = t.chain === chain && t.symbol === symbol;
                return (
                  <button
                    key={heldKey(t.chain, t.symbol)}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onPick(t)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${selected ? "bg-surface-2" : "hover:bg-surface"}`}
                  >
                    <span className="relative shrink-0">
                      <Icon src={t.icon} alt={t.symbol} size={34} />
                      {showNetwork && t.icon !== t.chainIcon && (
                        <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-panel">
                          <Icon src={t.chainIcon} alt={t.chainLabel} size={14} />
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{t.symbol}</span>
                      {showNetwork && <span className="truncate text-xs text-muted">{t.chainLabel}</span>}
                    </span>
                    {b && (
                      <span className="flex shrink-0 flex-col items-end">
                        <span className="text-sm tabular-nums">{amountText(b.amount, t.decimals)}</span>
                        <span className="text-xs tabular-nums text-muted">{b.usd !== null ? money(b.usd) : "—"}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted">{hint}</p>
      </div>
    </Modal>
  );
}

/** A balance for a list: up to 6 significant digits, never in exponent form. */
export function amountText(amount: string, decimals: number): string {
  const v = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const digits = whole.toString().length;
  const frac = Math.max(0, Math.min(decimals, whole > 0n ? 6 - digits : 6 + leadingZeros(v % base, decimals)));
  const f = (v % base).toString().padStart(decimals, "0").slice(0, frac).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${f ? `.${f}` : ""}`;
}

function leadingZeros(frac: bigint, decimals: number): number {
  const s = frac.toString().padStart(decimals, "0");
  return s.length - s.replace(/^0+/, "").length;
}
