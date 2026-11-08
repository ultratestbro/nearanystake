"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUnits, percent } from "@/lib/format";
import { type NearPoolInfo } from "@/lib/staking";
import { useAsync } from "@/lib/useAsync";
import { useNetworkStaking } from "./hooks";
import { CheckIcon, ShieldCheckIcon } from "./icons";
import { InfoHint } from "./InfoHint";
import { PoolAvatar, compactNear, poolBadge, poolName } from "./PoolAvatar";
import { StatusBadge } from "./StatusBadge";
import { Skeleton, Spinner } from "./ui";

const PAGE = 12;

/**
 * Pools from the validator set (one cached RPC call), with live fee / pause / code checks for the rows
 * shown. `compact` is the picker on the Stake card: each row is one button.
 */
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
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm outline-none focus:border-accent"
        />
        <button type="button" aria-pressed={hideTop} onClick={() => setHideTop(!hideTop)} className="btn-tactile min-h-11 justify-center px-3.5 text-sm font-medium">
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
              const loading = !byId.has(light.id) && details.loading;
              return compact && onPick ? (
                <PickRow key={p.id} p={p} loading={loading} onPick={onPick} picked={picked === p.id} />
              ) : (
                <PoolRow key={p.id} p={p} loading={loading} onPick={onPick} picked={picked === p.id} compact={compact} />
              );
            })}
          </ul>
          {list.length === 0 && <p className="p-4 text-sm text-muted">No pool matches.</p>}
        </div>
      )}
      {shown < list.length && (
        <button type="button" onClick={() => setShown(shown + PAGE)} className="btn-tactile min-h-11 self-center px-4 text-sm font-medium">
          Show more ({list.length - shown} left)
        </button>
      )}
      <p className="text-xs leading-5 text-muted">
        Only standard pools running known pool code can take stake; fee, pause and validator set are checked again before you sign. APR is after the pool&apos;s fee.{" "}
        <InfoHint label="How pools are checked">
          Standard pools are *.poolv1.near and *.pool.near accounts running known staking-pool code. APR = last epoch&apos;s reward ÷ stake, annualized, after the pool&apos;s fee.
        </InfoHint>
      </p>
    </div>
  );
}

function Badge({ p, loading }: { p: NearPoolInfo; loading: boolean }) {
  if (loading) return <Spinner />;
  const b = poolBadge(p);
  return (
    <StatusBadge tone={b.tone} icon={b.tone === "success" ? <ShieldCheckIcon size={14} /> : undefined} title={b.details}>
      {b.label}
    </StatusBadge>
  );
}

const feeText = (p: NearPoolInfo) => (p.feePercent !== null ? `${percent(p.feePercent, p.feePercent % 1 ? 1 : 0)} fee` : "fee —");

/** The picker's row: avatar, name, the numbers on one line, the trust mark, a check on the picked one. */
function PickRow({ p, loading, onPick, picked }: { p: NearPoolInfo; loading: boolean; onPick: (p: NearPoolInfo) => void; picked: boolean }) {
  const name = poolName(p.id);
  const apr = p.apr ?? p.grossApr;
  const blocked = p.details && !p.eligible;
  const b = poolBadge(p);
  return (
    <li>
      <button
        type="button"
        aria-pressed={picked}
        disabled={blocked}
        onClick={() => onPick(p)}
        aria-label={`${name}, ${apr !== null ? `${percent(apr)} APR` : "APR unknown"}, ${feeText(p)}. ${loading ? "" : b.details}`}
        className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:bg-surface"
      >
        <PoolAvatar name={name} size={36} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{name}</span>
          <span className="truncate text-[13px] leading-5 text-muted">
            {apr !== null ? `${percent(apr)}${p.apr === null ? "*" : ""} APR` : "APR —"} · {loading ? "…" : feeText(p)} · {compactNear(p.stake)} NEAR
          </span>
        </span>
        <Badge p={p} loading={loading} />
        <span className="grid w-4 shrink-0 place-items-center">{picked && <CheckIcon className="text-accent" />}</span>
      </button>
    </li>
  );
}

function PoolRow({ p, loading, onPick, picked, compact }: { p: NearPoolInfo; loading: boolean; onPick?: (p: NearPoolInfo) => void; picked: boolean; compact: boolean }) {
  const apr = p.apr ?? p.grossApr;
  const action = onPick ? (
    <button type="button" aria-pressed={picked} disabled={p.details && !p.eligible} onClick={() => onPick(p)} className="btn-tactile min-h-9 justify-center px-3 text-xs font-medium">
      {picked ? "Picked" : "Pick"}
    </button>
  ) : p.details && !p.eligible ? (
    // a link with aria-disabled still navigates: an ineligible pool gets no link at all
    <span aria-disabled="true" className="btn-tactile min-h-9 justify-center px-3 text-xs font-medium opacity-50">
      Stake
    </span>
  ) : (
    <Link href={`/stake?pool=${encodeURIComponent(p.id)}`} className="btn-tactile min-h-9 justify-center px-3 text-xs font-medium">
      Stake
    </Link>
  );
  return (
    <li className={`flex flex-col gap-2 px-4 py-3 ${compact ? "" : "md:grid md:grid-cols-[minmax(0,2.2fr)_1fr_0.7fr_0.8fr_0.7fr_1fr_auto] md:items-center md:gap-3"}`}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{poolName(p.id)}</p>
          <p className="truncate text-xs text-muted">{p.id}</p>
        </div>
        <span className={compact ? "" : "md:hidden"}>{action}</span>
      </div>
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted ${compact ? "" : "md:contents"}`}>
        <span className={`tabular-nums ${compact ? "" : "md:text-right md:text-text"}`}>
          {formatUnits(p.stake / 10n ** 24n, 0)} <span className="text-xs text-muted">NEAR</span>
        </span>
        <span className={`tabular-nums ${compact ? "" : "md:text-right md:text-text"}`}>{loading ? <Spinner /> : feeText(p)}</span>
        <span className={`tabular-nums ${compact ? "" : "md:text-right"} ${p.apr !== null ? "text-accent" : ""}`} title={p.apr === null ? "before the pool's fee" : undefined}>
          {apr !== null ? `${percent(apr)}${p.apr === null ? "*" : ""}` : "—"} <span className={`text-xs text-muted ${compact ? "" : "md:hidden"}`}>APR</span>
        </span>
        <span className={`tabular-nums ${compact ? "" : "md:text-right"}`}>
          {p.uptime !== null ? percent(p.uptime, 1) : "—"} <span className={`text-xs ${compact ? "" : "md:hidden"}`}>uptime</span>
        </span>
        <span>
          <Badge p={p} loading={false} />
        </span>
      </div>
      <span className={`hidden ${compact ? "" : "md:block"}`}>{action}</span>
    </li>
  );
}
