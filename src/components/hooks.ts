"use client";

import { useMemo } from "react";
import { liquidStaking, nativeStaking, type LiquidPreset } from "@/lib/staking";
import { useApp } from "./AppProvider";

/** Native staking for pure network reads (epoch, pools): any account works, the demo one is at hand. */
export function useNetworkStaking() {
  const { demo } = useApp();
  return useMemo(() => nativeStaking(demo), [demo]);
}

/** Native and liquid staking for the account being viewed: the connected wallet, or the demo account. */
export function useAccountStaking(view: "mine" | "demo") {
  const { near, demo } = useApp();
  const account = view === "mine" && near ? near.account : demo;
  const id = view === "mine" && near ? near.accountId : null;
  return useMemo(
    () => ({
      accountId: id,
      readOnly: !(view === "mine" && near),
      native: nativeStaking(account),
      liquid: Object.fromEntries((["rnear", "linear"] as LiquidPreset[]).map((p) => [p, liquidStaking(account, p)])) as Record<LiquidPreset, ReturnType<typeof liquidStaking>>,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account, id],
  );
}
