"use client";

import type { IWalletAccountReadOnly } from "@anywalletkit/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { canGoLive, initialDryRun } from "@/lib/dryrun";
import { DEMO_ACCOUNT, NEAR_NETWORK } from "@/lib/near/config";
import { nearClient } from "@/lib/near/reads";
import { selectorAccount, watchAccount, type SelectorAccount } from "@/lib/near/selector-account";

const DRY_KEY = "nearanystake.dry";

export interface NearConnection {
  accountId: string;
  walletName: string;
  icon: string;
  /** Signs through the user's wallet (one prompt per write). */
  account: SelectorAccount;
}

interface AppState {
  near: NearConnection | null;
  /** True until the silent reconnect after a reload had its chance. */
  restoring: boolean;
  connecting: boolean;
  error: string;
  /**
   * Opens the wallet picker. The mode then follows initialDryRun; `live: true` is for a control that
   * offered "connect to go live": that click is the user's newest choice, so it is remembered.
   */
  connectNear(opts?: { live?: boolean }): Promise<NearConnection | null>;
  disconnectNear(): void;
  /**
   * App-wide dry-run switch: real quotes, nothing payable. Always on without a NEAR wallet; off once
   * one connects, unless the user switched it on before (see initialDryRun).
   */
  dryRun: boolean;
  setDryRun(v: boolean): void;
  /** The read-only demo account (a public delegator with an unbonding balance). */
  demo: IWalletAccountReadOnly;
  demoId: string;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

/** The user's last pick of the switch in this browser: true = dry run ("1"), null = never picked. */
function remembered(): boolean | null {
  try {
    const v = localStorage.getItem(DRY_KEY);
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}

function remember(dry: boolean) {
  try {
    localStorage.setItem(DRY_KEY, dry ? "1" : "0");
  } catch {
    // private mode: the choice lasts until reload
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [near, setNear] = useState<NearConnection | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [dryRun, setDry] = useState(true);
  const tried = useRef(false);
  const demo = useMemo(() => watchAccount(DEMO_ACCOUNT, NEAR_NETWORK), []);

  const open = useCallback(async (silent: boolean): Promise<NearConnection> => {
    const [{ nearSignIn }, { actionCreators }] = await Promise.all([import("@/lib/near/selector"), import("@near-wallet-selector/core")]);
    const s = await nearSignIn({ silent });
    const account = selectorAccount(s.wallet, s.accountId, {
      rpc: nearClient().rpc,
      network: NEAR_NETWORK,
      functionCall: (m, args, gas, deposit) => actionCreators.functionCall(m, args, gas, deposit),
    });
    return { accountId: s.accountId, walletName: s.name, icon: s.icon, account };
  }, []);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    open(true)
      .then((c) => {
        setNear(c);
        setDry(initialDryRun(c.accountId, remembered()));
      })
      .catch(() => {})
      .finally(() => setRestoring(false));
  }, [open]);

  // follow account switches and sign-outs done in the wallet itself
  const nearId = near?.accountId ?? null;
  useEffect(() => {
    if (!nearId) return;
    let off: (() => void) | null = null;
    let live = true;
    void import("@/lib/near/selector")
      .then((m) =>
        m.watchActiveAccount((id) => {
          if (!id) {
            setNear(null);
            setDry(true);
            return;
          }
          open(true).then(
            (c) => {
              setNear(c);
              setDry(initialDryRun(c.accountId, remembered()));
            },
            () => {
              setNear(null);
              setDry(true);
            },
          );
        }),
      )
      .then((unsubscribe) => {
        if (live) off = unsubscribe;
        else unsubscribe();
      })
      .catch(() => {});
    return () => {
      live = false;
      off?.();
    };
  }, [nearId, open]);

  const connectNear = useCallback(async (opts?: { live?: boolean }) => {
    setError("");
    setConnecting(true);
    try {
      const c = await open(false);
      setNear(c);
      if (opts?.live === true) remember(false);
      setDry(initialDryRun(c.accountId, remembered()));
      return c;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/cancel/i.test(m) ? "" : /reject|denied/i.test(m) ? "You cancelled in the wallet." : m || "Could not connect.");
      return null;
    } finally {
      setConnecting(false);
    }
  }, [open]);

  const disconnectNear = useCallback(() => {
    void import("@/lib/near/selector").then((m) => m.nearSignOut());
    setNear(null);
    setDry(true);
  }, []);

  const setDryRun = useCallback(
    (v: boolean) => {
      // live quotes need a NEAR account to deliver to: without one the switch stays on
      if (!v && !canGoLive(near?.accountId ?? null)) return;
      setDry(v);
      remember(v);
    },
    [near],
  );

  const value = useMemo<AppState>(
    () => ({ near, restoring, connecting, error, connectNear, disconnectNear, dryRun, setDryRun, demo, demoId: DEMO_ACCOUNT }),
    [near, restoring, connecting, error, connectNear, disconnectNear, dryRun, setDryRun, demo],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
