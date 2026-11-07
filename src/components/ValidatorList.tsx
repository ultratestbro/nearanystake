"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUnits, percent } from "@/lib/format";
import { poolStatus, refusalText, type NearPoolInfo } from "@/lib/staking";
import { useAsync } from "@/lib/useAsync";
import { useNetworkStaking } from "./hooks";
import { Pill, Skeleton, Spinner } from "./ui";

const PAGE = 12;

/** Pools from the validator set (one cached RPC call), with live fee / pause / code checks for the rows shown. */
export function ValidatorList({ onPick, picked, compact = false }: { onPick?: (p: NearPoolInfo) => void; picked?: string; compact?: boolean }) {
  const staking = useNetworkStaking();
  const pools = useAsync(() => staking.listPools(), [staking]);
  const [q, setQ] = useState("");
  const [hideTop, setHideTop] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const list = useMemo(() => {
    const all = pools.data ?? [];
    const top = new Set(all.slice(0, 10).map((p) => p.id));
    const needle = q.trim().toLowerCase();
    return all.filter((p) => p.inCurrentSet && (!hideTop || !top.has(p.id)) && (!needle || p.id.includes(needle)));
  }, [pools.data, q, hideTop]);
  const visible = list.slice(0, shown);
  const ids = visible.map((p) => p.id).join(",");
  const details = useAsync(() => (ids ? staking.getPools(ids.split(",")) : Promise.resolve([])), [staking, ids]);
  const byId = new Map((details.data ?? []).map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setShown(PAGE);
          }}
          placeholder="Search pools"
          aria-label="Search pools"
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button type="button" aria-pressed={hideTop} onClick={() => setHideTop(!hideTop)} className="btn-tactile justify-center px-3.5 py-2.5 text-sm font-medium">
          Hide top 10 by stake
        </button>
      </div>
      {pools.error && <p className="text-sm text-danger">Couldn&apos;t load validators: {pools.error}</p>}
      {!pools.data && !pools.error && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}
      {pools.data && (
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className={`hidden grid-cols-[minmax(0,2.2fr)_1fr_0.7fr_0.8fr_0.7fr_1fr_auto] gap-3 border-b border-line bg-surface px-4 py-2.5 text-xs text-muted ${compact ? "" : "md:grid"}`}>
            <span>Pool</span>
            <span className="text-right">Stake</span>
            <span className="text-right">Fee</span>
            <span className="text-right">APR</span>
            <span className="text-right">Uptime</span>
            <span>Status</span>
            <span className="w-16" />
          </div>
          <ul className="divide-y divide-line">
            {visible.map((light) => {
              const p = byId.get(light.id) ?? light;
              return <PoolRow key={p.id} p={p} loading={!byId.has(light.id) && details.loading} onPick={onPick} picked={picked === p.id} compact={compact} />;
            })}
          </ul>
          {list.length === 0 && <p className="p-4 text-sm text-muted">No pool matches.</p>}
        </div>
      )}
      {shown < list.length && (
        <button type="button" onClick={() => setShown(shown + PAGE)} className="btn-tactile self-center px-4 py-2 text-sm font-medium">
          Show more ({list.length - shown} left)
        </button>
      )}
      <p className="text-xs text-muted">
        Only standard pools (<code>*.poolv1.near</code>, <code>*.pool.near</code>) running known staking-pool code can take stake; fee, pause and validator-set
        checks are re-read before every signature. APR = last epoch&apos;s reward ÷ stake, annualized, after the pool&apos;s fee.
      </p>
    </div>
  );
}

function PoolRow({ p, loading, onPick, picked, compact }: { p: NearPoolInfo; loading: boolean; onPick?: (p: NearPoolInfo) => void; picked: boolean; compact: boolean }) {
  const st = poolStatus(p);
  const apr = p.apr ?? p.grossApr;
  const action = onPick ? (
    <button type="button" aria-pressed={picked} disabled={p.details && !p.eligible} onClick={() => onPick(p)} className="btn-tactile justify-center px-3 py-1.5 text-xs font-medium">
      {picked ? "Picked" : "Pick"}
    </button>
  ) : (
    <Link href={`/stake?pool=${encodeURIComponent(p.id)}`} aria-disabled={p.details && !p.eligible} className="btn-tactile justify-center px-3 py-1.5 text-xs font-medium">
      Stake
    </Link>
  );
  const why = p.details && !p.eligible ? p.refusals.map(refusalText).join(", ") : "";
  return (
    <li className={`flex flex-col gap-2 px-4 py-3 ${compact ? "" : "md:grid md:grid-cols-[minmax(0,2.2fr)_1fr_0.7fr_0.8fr_0.7fr_1fr_auto] md:items-center md:gap-3"}`}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{p.id.replace(/\.(poolv1|pool)\.near$/, "")}</p>
          <p className="truncate text-xs text-muted">{p.id}</p>
        </div>
        <span className={compact ? "" : "md:hidden"}>{action}</span>
      </div>
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted ${compact ? "" : "md:contents"}`}>
        <span className={`tabular-nums ${compact ? "" : "md:text-right md:text-text"}`}>
          {formatUnits(p.stake / 10n ** 24n, 0)} <span className="text-xs text-muted">NEAR</span>
        </span>
        <span className={`tabular-nums ${compact ? "" : "md:text-right md:text-text"}`}>{loading ? <Spinner /> : p.feePercent !== null ? `${percent(p.feePercent, p.feePercent % 1 ? 1 : 0)} fee` : "—"}</span>
        <span className={`tabular-nums ${compact ? "" : "md:text-right"} ${p.apr !== null ? "text-accent" : ""}`} title={p.apr === null ? "before the pool's fee" : undefined}>
          {apr !== null ? `${percent(apr)}${p.apr === null ? "*" : ""}` : "—"} <span className={`text-xs text-muted ${compact ? "" : "md:hidden"}`}>APR</span>
        </span>
        <span className={`tabular-nums ${compact ? "" : "md:text-right"}`}>
          {p.uptime !== null ? percent(p.uptime, 1) : "—"} <span className={`text-xs ${compact ? "" : "md:hidden"}`}>uptime</span>
        </span>
        <span title={why}>
          <Pill tone={st.tone}>{st.label}</Pill>
        </span>
      </div>
      <span className={`hidden ${compact ? "" : "md:block"}`}>{action}</span>
    </li>
  );
}
