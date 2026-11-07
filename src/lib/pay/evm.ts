import type { PayInstruction, Payer } from "./types";

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

/** A connected EVM wallet (MetaMask, Rabby…): switch to the source chain, then a plain transfer. */
export function evmPayer(eth: Eip1193, address: string, label: string): Payer {
  return {
    family: "evm",
    label,
    address,
    async pay(p: PayInstruction) {
      const chainId = `0x${BigInt(p.chain.split(":")[1] ?? "0").toString(16)}`;
      if ((await eth.request({ method: "eth_chainId" })) !== chainId) {
        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
        } catch (e) {
          if ((e as { code?: number }).code === 4902) throw new Error("Add this network to your wallet first, then try again.");
          throw e;
        }
      }
      const amount = BigInt(p.amount);
      const tx = p.contract
        ? { from: address, to: p.contract, value: "0x0", data: erc20Transfer(p.to, amount) }
        : { from: address, to: p.to, value: `0x${amount.toString(16)}` };
      return (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as string;
    },
  };
}

function erc20Transfer(to: string, amount: bigint): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error("Bad deposit address.");
  return "0xa9059cbb" + to.slice(2).toLowerCase().padStart(64, "0") + amount.toString(16).padStart(64, "0");
}
