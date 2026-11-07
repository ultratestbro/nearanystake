import type { Payer } from "./types";

export { familyOf, type PayInstruction, type Payer } from "./types";
export { evmPayer } from "./evm";
export { solanaPayer } from "./solana";

export type SourceFamily = "evm" | "solana" | "ton" | "tron" | "bitcoin";

export const PAYER_LABEL: Record<SourceFamily, string> = {
  evm: "EVM wallet",
  solana: "Solana wallet",
  ton: "TON wallet",
  tron: "TronLink",
  bitcoin: "Bitcoin wallet",
};

/**
 * Connects a wallet on the source chain to pay the deposit. EVM and Solana go through Reown AppKit
 * when a project id is configured; without one, EVM falls back to the browser's injected wallet.
 * Any chain can also be paid by hand (the deposit address + QR), so a wallet here is optional.
 */
export async function connectPayer(family: SourceFamily): Promise<Payer> {
  if (family === "tron") return (await import("./tron")).connectTronPayer();
  if (family === "ton") return (await import("./ton")).connectTonPayer();
  if (family === "bitcoin") return (await import("./btc")).connectBtcPayer();
  const kit = await import("../appkit");
  if (family === "evm") {
    if (!kit.WC_PROJECT_ID) return injectedEvm();
    const a = await kit.kitConnect("eip155");
    const { evmPayer } = await import("./evm");
    return evmPayer(await kit.kitEip1193(), a.address, a.name);
  }
  if (!kit.WC_PROJECT_ID) throw new Error("Solana wallets need NEXT_PUBLIC_REOWN_PROJECT_ID. Send the deposit by hand instead.");
  const a = await kit.kitConnect("solana");
  const sol = await kit.kitSolana();
  const { solanaPayer } = await import("./solana");
  return solanaPayer(a.address, a.name, sol.send);
}

async function injectedEvm(): Promise<Payer> {
  const eth = (window as unknown as { ethereum?: { request(a: { method: string; params?: unknown[] }): Promise<unknown> } }).ethereum;
  if (!eth) throw new Error("No EVM wallet found in this browser. Send the deposit by hand instead.");
  const [address] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  if (!address) throw new Error("The wallet returned no account.");
  const { evmPayer } = await import("./evm");
  return evmPayer(eth, address, "Browser wallet");
}

export function payerFamily(caip2: string): SourceFamily | null {
  const ns = caip2.split(":")[0];
  if (ns === "eip155") return "evm";
  if (ns === "solana" || ns === "ton" || ns === "tron" || ns === "bitcoin") return ns;
  return null;
}
