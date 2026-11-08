// NEAR wallets through wallet-selector 10 (Meteor, HERE, Intear: popups, no redirect mid-flow).
// The same setup as NearJar's payer (same author). Browser only: every import is dynamic.

import type { Wallet, WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { PUBLIC_RPC } from "./config";

let selector: Promise<WalletSelector> | null = null;

export function getSelector(): Promise<WalletSelector> {
  selector ??= (async () => {
    const [{ setupWalletSelector }, { setupMeteorWallet }, { setupHereWallet }, { setupIntearWallet }] = await Promise.all([
      import("@near-wallet-selector/core"),
      import("@near-wallet-selector/meteor-wallet"),
      import("@near-wallet-selector/here-wallet"),
      import("@near-wallet-selector/intear-wallet"),
    ]);
    return setupWalletSelector({
      network: { networkId: "mainnet", nodeUrl: PUBLIC_RPC, helperUrl: "https://helper.mainnet.near.org", explorerUrl: "https://nearblocks.io", indexerUrl: "https://api.kitwallet.app" },
      modules: [setupMeteorWallet(), setupHereWallet(), setupIntearWallet()],
    });
  })();
  selector.catch(() => {
    selector = null;
  });
  return selector;
}

let modal: Promise<WalletSelectorModal> | null = null;
let onHide: (() => void) | null = null;

function selectorModal(): Promise<WalletSelectorModal> {
  modal ??= (async () => {
    const [s, { setupModal }] = await Promise.all([getSelector(), import("@near-wallet-selector/modal-ui"), import("@near-wallet-selector/modal-ui/styles.css")]);
    // no contract: the app needs the account and full signatures, never a function-call key
    const m = setupModal(s, { contractId: "", theme: "dark" });
    m.on("onHide", ({ hideReason }) => hideReason === "user-triggered" && onHide?.());
    return m;
  })();
  modal.catch(() => (modal = null));
  return modal;
}

export interface NearSession {
  wallet: Wallet;
  accountId: string;
  name: string;
  icon: string;
}

/** Signs in through the modal, or (`silent`) only picks up a session the selector already has. */
export async function nearSignIn({ silent = false } = {}): Promise<NearSession> {
  const s = await getSelector();
  const active = () => {
    const st = s.store.getState();
    return st.selectedWalletId ? st.accounts.find((a) => a.active)?.accountId : undefined;
  };
  if (!active()) {
    if (silent) throw new Error("not authorised");
    const m = await selectorModal();
    await new Promise<void>((resolve, reject) => {
      const sub = s.store.observable.subscribe(() => {
        if (!active()) return;
        sub.unsubscribe();
        onHide = null;
        m.hide();
        resolve();
      });
      onHide = () => {
        sub.unsubscribe();
        onHide = null;
        reject(new Error("cancelled"));
      };
      m.show();
    });
  }
  const accountId = active();
  if (!accountId) throw new Error("The wallet returned no NEAR account.");
  const wallet = await s.wallet();
  const meta = s.store.getState().modules.find((x) => x.id === s.store.getState().selectedWalletId)?.metadata;
  return { wallet, accountId, name: meta?.name ?? "NEAR wallet", icon: meta?.iconUrl ?? "" };
}

/**
 * Calls `onChange` whenever the wallet's active account changes (a switch inside the wallet, a sign-out
 * in another tab), so the app never keeps signing for, or delivering to, an account the user left.
 */
export async function watchActiveAccount(onChange: (accountId: string | null) => void): Promise<() => void> {
  const s = await getSelector();
  const active = () => {
    const st = s.store.getState();
    return st.selectedWalletId ? (st.accounts.find((a) => a.active)?.accountId ?? null) : null;
  };
  let last = active();
  const sub = s.store.observable.subscribe(() => {
    const now = active();
    if (now === last) return;
    last = now;
    onChange(now);
  });
  return () => sub.unsubscribe();
}

export async function nearSignOut(): Promise<void> {
  await getSelector()
    .then((s) => s.wallet())
    .then((w) => w.signOut())
    .catch(() => {});
}
