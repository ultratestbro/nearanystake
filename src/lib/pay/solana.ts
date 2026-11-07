import { WalletAccountReadOnlySolana } from "@anywalletkit/wallet-solana";
import { compileTransaction, getBase64EncodedWireTransaction } from "@solana/kit";
import type { PayInstruction, Payer } from "./types";

/**
 * Exposes Any Wallet Kit's Solana transfer builders (native SOL, SPL with the recipient's token
 * account created idempotently, compute budget, simulation) for an external wallet to sign.
 */
class DepositBuilder extends WalletAccountReadOnlySolana {
  async depositWire(p: PayInstruction): Promise<Uint8Array> {
    const built = p.contract
      ? await this.buildTokenTransfer(p.contract, p.to, BigInt(p.amount))
      : { message: await this.buildNativeTransfer(p.to, BigInt(p.amount)), tokenFee: 0n };
    // simulate before the wallet sees it: a transfer that would fail never asks for a signature
    const plan = await this.planMessage(built.message, { simulate: true, tokenFee: built.tokenFee });
    const tx = plan.transaction ?? compileTransaction(plan.message as never);
    const wire = getBase64EncodedWireTransaction(tx as never);
    return Uint8Array.from(atob(wire), (c) => c.charCodeAt(0));
  }
}

/**
 * A connected Solana wallet (Phantom, Solflare, Backpack… or a phone wallet over WalletConnect):
 * SDK-built transfer, signed and sent through `send`, which returns the signature.
 */
export function solanaPayer(address: string, label: string, send: (wire: Uint8Array) => Promise<string>): Payer {
  const builder = new DepositBuilder(address, { provider: `${window.location.origin}/api/rpc/solana` });
  return {
    family: "solana",
    label,
    address,
    async pay(p) {
      return send(await builder.depositWire(p));
    },
  };
}
