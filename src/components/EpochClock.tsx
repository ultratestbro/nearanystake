"use client";

import { bigintToNumber } from "@anywalletkit/core";
import { NUM_EPOCHS_TO_UNLOCK, type NearEpoch } from "@/lib/staking";
import { dateTime, duration } from "@/lib/format";
import { useAsync, useNow } from "@/lib/useAsync";
import { useNetworkStaking } from "./hooks";
import { Progress, Skeleton } from "./ui";

/**
 * Unlock of an unstake made now. It unlocks at the start of epoch N + 4: exactly 3 epochs after this
 * one ends. Only a transaction that lands after this epoch's end unlocks one epoch later (`ifLate`).
 */
export function unbondingWindow(e: NearEpoch): { at: number; ifLate: number } {
  const n = bigintToNumber(NUM_EPOCHS_TO_UNLOCK);
  return { at: e.endsAt + (n - 1) * e.epochMs, ifLate: e.endsAt + n * e.epochMs };
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
            Unstake now and native NEAR unlocks at epoch {(e.height + NUM_EPOCHS_TO_UNLOCK).toString()}, around {dateTime(w.at)} (in about {Math.round((w.at - now) / 3_600_000)} h);
            one epoch later if the transaction lands after this epoch ends.
          </>
        )}
      </p>
    </div>
  );
}
