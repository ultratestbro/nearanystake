import type { PayInstruction, Payer } from "./types";

type Unisat = {
  requestAccounts(): Promise<string[]>;
  sendBitcoin(to: string, sats: number): Promise<string>;
};

/** Bitcoin: Unisat (or OKX's Unisat-compatible provider) when injected, otherwise Xverse / Leather via sats-connect. */
export async function connectBtcPayer(): Promise<Payer> {
  const w = window as unknown as { unisat?: Unisat; okxwallet?: { bitcoin?: Unisat } };
  const injected = w.unisat ?? w.okxwallet?.bitcoin;
  if (injected) {
    const [address] = await injected.requestAccounts();
    if (!address) throw new Error("The wallet returned no account.");
    return { family: "bitcoin", label: "Bitcoin wallet", address, pay: (p) => injected.sendBitcoin(p.to, sats(p)) };
  }

  const { request, AddressPurpose } = await import("sats-connect");
  const r = (await request("wallet_connect", { addresses: [AddressPurpose.Payment], message: "NearAnyStake deposit" })) as {
    status: string;
    result?: { addresses: { address: string; purpose: string }[] };
    error?: { message?: string };
  };
  if (r.status !== "success") throw new Error(r.error?.message ?? "No Bitcoin wallet found. Install Xverse, Leather or Unisat.");
  const address = r.result?.addresses.find((a) => a.purpose === AddressPurpose.Payment)?.address;
  if (!address) throw new Error("The wallet returned no payment address.");
  return {
    family: "bitcoin",
    label: "Bitcoin wallet",
    address,
    async pay(p: PayInstruction) {
      const res = (await request("sendTransfer", { recipients: [{ address: p.to, amount: sats(p) }] })) as {
        status: string;
        result?: { txid: string };
        error?: { message?: string };
      };
      if (res.status !== "success" || !res.result?.txid) throw new Error(res.error?.message ?? "The payment was not sent.");
      return res.result.txid;
    },
  };
}

function sats(p: PayInstruction): number {
  if (p.contract) throw new Error("Only native BTC is supported.");
  if (p.memo) throw new Error("This deposit needs a memo, which Bitcoin wallets can't add.");
  const n = BigInt(p.amount);
  if (n <= 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Bad amount.");
  return Number(n);
}
