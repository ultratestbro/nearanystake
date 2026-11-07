import type { PayInstruction, Payer } from "./types";

interface TronWebLike {
  defaultAddress: { base58: string | false };
  trx: {
    sign(tx: unknown): Promise<unknown>;
    sendRawTransaction(signed: unknown): Promise<{ result?: boolean; txid?: string; code?: string; message?: string }>;
  };
  transactionBuilder: {
    sendTrx(to: string, amount: number, from: string): Promise<unknown>;
    triggerSmartContract(
      contract: string,
      fn: string,
      options: Record<string, unknown>,
      params: { type: string; value: unknown }[],
      from: string,
    ): Promise<{ result?: { result?: boolean }; transaction?: unknown }>;
  };
}
type TronWindow = { tronLink?: { request(a: { method: string }): Promise<unknown>; tronWeb?: TronWebLike }; tronWeb?: TronWebLike };

// TRC-20 transfers burn TRX for energy when the sender has none staked; 100 TRX caps a runaway call.
const FEE_LIMIT_SUN = 100_000_000;

/** TronLink (and wallets injecting a compatible `tronWeb`): TRX or TRC-20 transfer, signed and broadcast by the wallet. */
export async function connectTronPayer(): Promise<Payer> {
  const w = window as unknown as TronWindow;
  if (!w.tronLink && !w.tronWeb) throw new Error("No Tron wallet found. Install TronLink.");
  await w.tronLink?.request({ method: "tron_requestAccounts" });
  const tw = w.tronLink?.tronWeb ?? w.tronWeb;
  const address = tw?.defaultAddress?.base58;
  if (!tw || !address) throw new Error("Unlock TronLink and try again.");
  return {
    family: "tron",
    label: "TronLink",
    address,
    async pay(p: PayInstruction) {
      const amount = BigInt(p.amount);
      let tx: unknown;
      if (p.contract) {
        const built = await tw.transactionBuilder.triggerSmartContract(
          p.contract,
          "transfer(address,uint256)",
          { feeLimit: FEE_LIMIT_SUN, callValue: 0 },
          [
            { type: "address", value: p.to },
            { type: "uint256", value: amount.toString() },
          ],
          address,
        );
        if (!built.result?.result || !built.transaction) throw new Error("Could not build the token transfer.");
        tx = built.transaction;
      } else {
        if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount too large.");
        tx = await tw.transactionBuilder.sendTrx(p.to, Number(amount), address);
      }
      const signed = await tw.trx.sign(tx);
      const r = await tw.trx.sendRawTransaction(signed);
      if (!r.result || !r.txid) throw new Error(r.message ?? r.code ?? "Broadcast failed.");
      return r.txid;
    },
  };
}
