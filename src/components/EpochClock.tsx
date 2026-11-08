"use client";

import { bigintToNumber } from "@anywalletkit/core";
import { NUM_EPOCHS_TO_UNLOCK, type NearEpoch } from "@/lib/staking";
import { dateTime, duration } from "@/lib/format";
import { useAsync, useNow } from "@/lib/useAsync";
import { useNetworkStaking } from "./hooks";
import { InfoHint } from "./InfoHint";
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

/**
 * The epoch clock. `compact`: one figure for a summary row ("Next reward · in 3 h 44 min"), with the
 * epoch number and what it means behind an (i); `label` names the figure. The full card is for the
 * home page.
 */
export function EpochClock({ compact = false, label = "Next epoch" }: { compact?: boolean; label?: string }) {
  const { data: e, error } = useEpoch();
  const now = useNow(compact ? 15_000 : 1000);
  if (compact) {
    const left = e ? Math.max(0, e.endsAt - now) : 0;
    return (
      <div>
        <p className="flex min-h-6 items-center gap-1 text-[13px] text-muted">
          {label}
          {e && (
            <InfoHint label="About epochs">
              {`Epoch ${e.height.toString()} ends around ${dateTime(e.endsAt)}. NEAR adds staking rewards once per epoch, and unstaked NEAR unlocks when an epoch starts.`}
            </InfoHint>
          )}
        </p>
        {e ? (
          <p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">{left > 0 ? `in ${duration(left)}` : "any minute now"}</p>
        ) : error ? (
          <p className="mt-1 text-xl font-semibold text-muted">—</p>
        ) : (
          <Skeleton className="mt-1 h-7 w-32" />
        )}
        <p className="mt-1 text-[13px] text-muted">{e ? `Added every epoch, about every ${(e.epochMs / 3_600_000).toFixed(1)} h` : error ? "Epoch data unavailable right now" : " "}</p>
      </div>
    );
  }
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
        One epoch lasts ~{(e.epochMs / 3_600_000).toFixed(1)} h (measured on chain, not 12 h). Unstake now and native NEAR unlocks at epoch{" "}
        {(e.height + NUM_EPOCHS_TO_UNLOCK).toString()}, around {dateTime(w.at)} (in about {Math.round((w.at - now) / 3_600_000)} h); one epoch later if the
        transaction lands after this epoch ends.
      </p>
    </div>
  );
}
