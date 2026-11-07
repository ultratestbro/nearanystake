// Reown AppKit for EVM and Solana wallets: one modal lists the browser's extensions, phone wallets
// over WalletConnect (a QR on desktop, deep links on phones) and the whole wallet directory. The
// Wagmi adapter holds the EVM connection, the Solana adapter the Solana one; AppKit remembers both
// across reloads. Loaded on first use.

import type { AppKit } from "@reown/appkit";
import type { Config } from "@wagmi/core";
import { CC_SOURCE_CHAINS } from "@anywalletkit/swap2-assets";

export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

export type KitNamespace = "eip155" | "solana";

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

interface SolanaProvider {
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  signAndSendTransaction(tx: unknown): Promise<string>;
  signTransaction<T>(tx: T): Promise<T>;
}

let loading: Promise<{ modal: AppKit; wagmi: Config }> | null = null;

function load() {
  loading ??= (async () => {
    if (!WC_PROJECT_ID) throw new Error("Wallet connections are not set up on this site.");
    const [{ createAppKit }, networks, { WagmiAdapter }, { SolanaAdapter }] = await Promise.all([
      import("@reown/appkit"),
      import("@reown/appkit/networks"),
      import("@reown/appkit-adapter-wagmi"),
      import("@reown/appkit-adapter-solana"),
    ]);
    // every EVM chain a deposit can come from, Ethereum first
    const ids = CC_SOURCE_CHAINS.map((c) => c.caip2).filter((c) => c.startsWith("eip155:")).map((c) => Number(c.slice(7)));
    const known = new Map<number, (typeof networks)["mainnet"]>();
    for (const n of Object.values(networks)) {
      const c = n as (typeof networks)["mainnet"] & { testnet?: boolean };
      if (c && typeof c === "object" && typeof c.id === "number" && !c.testnet && !known.has(c.id)) known.set(c.id, c);
    }
    const evm = ids.flatMap((id) => known.get(id) ?? []);
    const [first, ...rest] = evm.length ? evm : [networks.mainnet];
    const origin = window.location.origin;
    const metadata = { name: "Stake Anywhere", description: "Stake NEAR from any chain", url: origin, icons: [`${origin}/icon-180.png`] };
    const wagmiAdapter = new WagmiAdapter({ projectId: WC_PROJECT_ID, networks: [first!, ...rest] });
    const modal = createAppKit({
      adapters: [wagmiAdapter, new SolanaAdapter()],
      networks: [first!, ...rest, networks.solana],
      defaultNetwork: first,
      projectId: WC_PROJECT_ID,
      metadata,
      themeMode: "dark",
      // the app palette: green accent, the page's grey surfaces and font, above our own dialogs
      themeVariables: {
        "--w3m-accent": "#00ec97",
        "--w3m-color-mix": "#262626",
        "--w3m-color-mix-strength": 30,
        "--w3m-font-family": 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif',
        "--w3m-border-radius-master": "4px",
        "--w3m-z-index": 1000,
      },
      features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, history: false, send: false },
    });
    return { modal, wagmi: wagmiAdapter.wagmiConfig };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

export interface KitAccount {
  address: string;
  name: string;
  icon: string;
}

/**
 * Opens AppKit's connect view for `ns`, or, `silent`, only picks up the session AppKit restored on
 * its own. Resolves once the wallet approved an account; closing the modal without one rejects.
 */
export async function kitConnect(ns: KitNamespace, { silent = false } = {}): Promise<KitAccount> {
  const { modal } = await load();
  const connected = () => {
    const a = modal.getAccount(ns);
    return a?.isConnected && a.address ? a.address : null;
  };
  // AppKit reconnects a remembered wallet after it loads: give that a moment before deciding
  await settle(modal, ns, silent ? 4000 : 1500);
  if (!connected()) {
    if (silent) throw new Error("not authorised");
    await new Promise<void>((resolve, reject) => {
      let opened = false;
      const offAccount = modal.subscribeAccount((a) => {
        if (a.isConnected && a.address) finish(resolve);
      }, ns);
      const offState = modal.subscribeState((s) => {
        if (s.open) opened = true;
        // the account event can trail the modal closing by a tick
        else if (opened) setTimeout(() => !connected() && finish(() => reject(new Error("cancelled"))), 400);
      });
      let done = false;
      function finish(then: () => void) {
        if (done) return;
        done = true;
        offAccount();
        offState();
        then();
      }
      void modal.open({ view: "Connect", namespace: ns });
    });
    void modal.close();
  }
  const info = modal.getWalletInfo(ns);
  return {
    address: connected()!,
    name: info?.name || (ns === "solana" ? "Solana wallet" : "EVM wallet"),
    icon: info?.icon ?? "",
  };
}

function settle(modal: AppKit, ns: KitNamespace, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const busy = () => {
      const a = modal.getAccount(ns);
      return !(a?.isConnected && a.address) && (a?.status === "connecting" || a?.status === "reconnecting" || a?.status === undefined);
    };
    if (!busy()) return resolve();
    const t = setTimeout(done, ms);
    const off = modal.subscribeAccount(() => !busy() && done(), ns);
    function done() {
      clearTimeout(t);
      off();
      resolve();
    }
  });
}

export async function kitDisconnect(ns: KitNamespace): Promise<void> {
  if (!loading) return;
  const { modal } = await loading;
  await modal.disconnect(ns).catch(() => {});
}

/** On a phone, a WalletConnect request waits in the wallet app: switch to it, as its metadata allows. */
async function nudge(ns: KitNamespace) {
  if (!loading || !window.matchMedia("(pointer: coarse)").matches) return;
  const { modal } = await loading;
  const r = modal.getWalletInfo(ns)?.redirect as { native?: string; universal?: string } | undefined;
  const to = r?.native || r?.universal;
  if (to) window.location.href = to;
}

/** An EIP-1193 face over wagmi, so the same code signs and pays from an extension or a phone wallet. */
export async function kitEip1193(): Promise<Eip1193> {
  const { wagmi } = await load();
  const core = await import("@wagmi/core");
  const chainId = () => core.getAccount(wagmi).chainId ?? wagmi.chains[0]!.id;
  return {
    async request({ method, params = [] }) {
      if (method === "eth_chainId") return `0x${chainId().toString(16)}`;
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [core.getAccount(wagmi).address];
      if (method === "wallet_switchEthereumChain") {
        const id = Number(BigInt((params[0] as { chainId: string }).chainId));
        if (!wagmi.chains.some((c) => c.id === id)) throw Object.assign(new Error("This network is not available here."), { code: 4902 });
        await core.switchChain(wagmi, { chainId: id as never });
        return null;
      }
      if (method === "personal_sign") {
        const out = core.signMessage(wagmi, { message: { raw: params[0] as `0x${string}` } });
        void nudge("eip155");
        return out;
      }
      if (method === "eth_sendTransaction") {
        const tx = params[0] as { to: `0x${string}`; value?: string; data?: `0x${string}` };
        const out = core.sendTransaction(wagmi, { to: tx.to, value: BigInt(tx.value ?? 0), data: tx.data, chainId: chainId() as never });
        void nudge("eip155");
        return out;
      }
      throw new Error(`Unsupported wallet call ${method}.`);
    },
  };
}

/** The connected Solana wallet: signs a message, and signs and sends a wire transaction. */
export async function kitSolana(): Promise<{ signMessage(m: Uint8Array): Promise<Uint8Array>; send(wire: Uint8Array): Promise<string> }> {
  const { modal } = await load();
  const provider = () => {
    const p = modal.getProvider<SolanaProvider>("solana");
    if (!p) throw new Error("The Solana wallet is not connected.");
    return p;
  };
  return {
    async signMessage(m) {
      const out = provider().signMessage(m);
      void nudge("solana");
      return out;
    },
    async send(wire) {
      const { VersionedTransaction } = await import("@solana/web3.js");
      const tx = VersionedTransaction.deserialize(wire);
      try {
        const out = provider().signAndSendTransaction(tx);
        void nudge("solana");
        return await out;
      } catch (e) {
        // sign-only wallets: sign here and broadcast through our node
        if (!/not supported|unsupported|method/i.test(e instanceof Error ? e.message : String(e))) throw e;
        const signed = await provider().signTransaction(tx);
        return broadcastSolana(signed.serialize());
      }
    },
  };
}

async function broadcastSolana(signed: Uint8Array): Promise<string> {
  const res = await fetch("/api/rpc/solana", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [btoa(String.fromCharCode(...signed)), { encoding: "base64" }],
    }),
  });
  const data = (await res.json()) as { result?: string; error?: { message?: string } };
  if (!data.result) throw new Error(data.error?.message ?? "Solana RPC rejected the transaction.");
  return data.result;
}
