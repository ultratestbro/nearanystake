import type { PayInstruction, Payer } from "./types";

// @ton/core needs Buffer in the browser; install it before the dynamic import below.
async function tonCore() {
  const { Buffer } = await import("buffer");
  (globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
  return import("@ton/core");
}

const JETTON_TRANSFER_OP = 0x0f8a7ea5;
// TON attached to a jetton transfer for gas; the excess returns to the sender.
const JETTON_GAS_NANO = 50_000_000n;

type TonConnectUIType = import("@tonconnect/ui").TonConnectUI;
let ui: TonConnectUIType | null = null;

export async function connector(): Promise<TonConnectUIType> {
  if (ui) return ui;
  const { TonConnectUI } = await import("@tonconnect/ui");
  ui = new TonConnectUI({ manifestUrl: `${window.location.origin}/tonconnect-manifest.json` });
  return ui;
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch("/api/rpc/ton", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { ok?: boolean; result?: T; error?: unknown };
  if (body.result === undefined) throw new Error(`TON ${method} failed`);
  return body.result;
}

/** The sender's jetton wallet for a jetton master (get_wallet_address). */
async function jettonWalletOf(master: string, owner: string): Promise<string> {
  const { Address, beginCell, Cell } = await tonCore();
  const ownerSlice = beginCell().storeAddress(Address.parse(owner)).endCell().toBoc().toString("base64");
  const r = await rpc<{ exit_code?: number; stack?: [string, { bytes?: string }][] }>("runGetMethod", {
    address: master,
    method: "get_wallet_address",
    stack: [["tvm.Slice", ownerSlice]],
  });
  const bytes = r.stack?.[0]?.[1]?.bytes;
  if (r.exit_code !== 0 || !bytes) throw new Error("Could not find your token wallet.");
  return Cell.fromBase64(bytes).beginParse().loadAddress().toString({ bounceable: true });
}

/** Opens the TON Connect modal unless a wallet is connected; `silent` only waits for a restored session. */
export async function tonConnect({ silent = false } = {}): Promise<TonConnectUIType> {
  const c = await connector();
  await c.connectionRestored;
  if (silent && !c.connected) throw new Error("not authorised");
  if (!c.connected) {
    const connected = new Promise<void>((resolve, reject) => {
      const off = c.onStatusChange(
        (w) => {
          if (w) {
            off();
            resolve();
          }
        },
        (e) => {
          off();
          reject(e);
        },
      );
      c.onModalStateChange((s) => {
        if (s.status === "closed" && !c.connected) reject(new Error("You closed the wallet window."));
      });
    });
    await c.openModal();
    await connected;
  }
  return c;
}

/** Tonkeeper, MyTonWallet, Telegram Wallet… via TON Connect (QR for mobile wallets). */
export async function connectTonPayer(): Promise<Payer> {
  const c = await tonConnect();
  const { Address } = await tonCore();
  const raw = c.account?.address;
  if (!raw) throw new Error("The wallet returned no account.");
  const address = Address.parse(raw).toString({ bounceable: false });

  return {
    family: "ton",
    label: c.wallet && "name" in c.wallet ? String(c.wallet.name) : "TON wallet",
    address,
    async pay(p: PayInstruction) {
      const { Address, beginCell, Cell } = await tonCore();
      const comment = p.memo ? beginCell().storeUint(0, 32).storeStringTail(p.memo).endCell() : null;
      let message: { address: string; amount: string; payload?: string };
      if (p.contract) {
        const jettonWallet = await jettonWalletOf(p.contract, address);
        const body = beginCell()
          .storeUint(JETTON_TRANSFER_OP, 32)
          .storeUint(BigInt(Date.now()), 64)
          .storeCoins(BigInt(p.amount))
          .storeAddress(Address.parse(p.to))
          .storeAddress(Address.parse(address)) // excess TON returns to the sender
          .storeBit(false)
          .storeCoins(1n); // forward 1 nanoton so the deposit address gets a transfer notification
        if (comment) body.storeBit(true).storeRef(comment);
        else body.storeBit(false);
        message = { address: jettonWallet, amount: JETTON_GAS_NANO.toString(), payload: body.endCell().toBoc().toString("base64") };
      } else {
        message = {
          address: Address.parse(p.to).toString({ bounceable: false }),
          amount: p.amount,
          ...(comment ? { payload: comment.toBoc().toString("base64") } : {}),
        };
      }
      const r = await c.sendTransaction({ validUntil: Math.floor(Date.now() / 1000) + 600, messages: [message] });
      // hash of the signed external message; 1Click and explorers resolve it to the transaction
      return Cell.fromBase64(r.boc).hash().toString("hex");
    },
  };
}
