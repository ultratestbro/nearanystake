"use client";

import { useMemo } from "react";
import { percent } from "@/lib/format";
import { liquidStaking } from "@/lib/staking";
import { useAsync } from "@/lib/useAsync";
import { useApp } from "./AppProvider";
import { useNetworkStaking } from "./hooks";
import { Skeleton, Stat } from "./ui";

export function LandingStats() {
  const staking = useNetworkStaking();
  const { demo } = useApp();
  const stats = useAsync(() => staking.getNetworkStats(), [staking]);
  const rnear = useMemo(() => liquidStaking(demo, "rnear"), [demo]);
  const linear = useMemo(() => liquidStaking(demo, "linear"), [demo]);
  const rApr = useAsync(() => rnear.getApr(), [rnear]);
  const lApr = useAsync(() => linear.getApr(), [linear]);
  const v = (x: number | undefined, err: string) => (x !== undefined ? percent(x) : err ? "—" : <Skeleton className="h-7 w-16" />);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label="Native staking APR" value={v(stats.data ? stats.data.apr * 0.95 : undefined, stats.error)} hint={stats.data ? `after a 5 % pool fee; network ${percent(stats.data.apr)} gross` : "from the protocol's rewards"} />
      <Stat label="Rhea rNEAR" value={v(rApr.data, rApr.error)} hint="7-day price growth" />
      <Stat label="LiNEAR" value={v(lApr.data, lApr.error)} hint="7-day price growth" />
      <Stat label="Native unbonding" value="21–28 h" hint="4 epoch boundaries, ~7 h each" />
    </div>
  );
}
