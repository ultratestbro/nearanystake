import { describe, expect, it, vi } from "vitest";
import { evmPayer } from "./evm";

const instr = { chain: "eip155:8453", symbol: "USDC", contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, amount: "5000000", to: "0x62F099A5C804f165351eE84CA41239b4283fAe1a", memo: null, validUntilMs: 0 };

describe("EVM payer binds the chain (L8)", () => {
  it("refuses when the wallet is still on another network after the switch", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => (method === "eth_chainId" ? "0x1" : null));
    await expect(evmPayer({ request }, "0xabc", "Wallet").pay(instr)).rejects.toThrow(/another network/);
    expect(request.mock.calls.some(([a]) => a.method === "eth_sendTransaction")).toBe(false);
  });

  it("sends with the chain id in the transaction", async () => {
    let chain = "0x1";
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") chain = (params![0] as { chainId: string }).chainId;
      if (method === "eth_sendTransaction") return "0xhash";
      return null;
    });
    expect(await evmPayer({ request }, "0xabc", "Wallet").pay(instr)).toBe("0xhash");
    const sent = request.mock.calls.find(([a]) => a.method === "eth_sendTransaction")![0].params![0] as { chainId: string };
    expect(sent.chainId).toBe("0x2105");
  });
});
