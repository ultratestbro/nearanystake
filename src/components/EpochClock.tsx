"use client";

import { bigintToNumber } from "@anywalletkit/core";
import { NUM_EPOCHS_TO_UNLOCK, type NearEpoch } from "@/lib/staking";
import { dateTime, duration } from "@/lib/format";
import { useAsync, useNow } from "@/lib/useAsync";
import { useNetworkStaking } from "./hooks";
import { Progress, Skeleton } from "./ui";

/** Unbonding of an unstake made now: 4 more epoch boundaries, the first being this epoch's end. */
export function unbondingWindow(e: NearEpoch): { earliest: number; latest: number } {
  // unstake in epoch N unlocks at the start of N+4: between 3 and 4 full epochs after this one ends
  const n = bigintToNumber(NUM_EPOCHS_TO_UNLOCK);
  return { earliest: e.endsAt + (n - 1) * e.epochMs, latest: e.endsAt + n * e.epochMs };
}

export function useEpoch() {
  const staking = useNetworkStaking();
  return useAsync(() => staking.getEpoch(), [staking], 60_000);
}

export function EpochClock({ compact = false }: { compact?: boolean }) {
  const { data: e, error } = useEpoch();
  const now = useNow(1000);
  if (error) return <p className="text-sm text-muted">Epoch data unavailable right now.</p>;
  if (!e) return <Skeleton className="h-24 w-full" />;
  const total = e.epochMs;
  const left = Math.max(0, e.endsAt - now);
  const pct = ((total - left) / total) * 100;
  const w = unbondingWindow(e);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">Epoch {e.height.toString()}</p>
        <p className="text-sm tabular-nums text-muted">ends in {duration(left)}</p>
      </div>
      <Progress pct={pct} />
      <p className="text-xs text-muted">
        One epoch lasts ~{(e.epochMs / 3_600_000).toFixed(1)} h (measured on chain, not 12 h).
        {!compact && (
          <>
            {" "}
            Unstake now and native NEAR unlocks at epoch {(e.height + NUM_EPOCHS_TO_UNLOCK).toString()}: between {dateTime(w.earliest)} and {dateTime(w.latest)} (in about{" "}
            {Math.round((w.earliest - now) / 3_600_000)}–{Math.round((w.latest - now) / 3_600_000)} h).
          </>
        )}
      </p>
    </div>
  );
}
