import { ReadOnlyAccountError, SignerError, UserRejectedError } from "@anywalletkit/core";
import type { NearRpc } from "@anywalletkit/wallet-near";
import { describe, expect, it, vi } from "vitest";
import { selectorAccount, watchAccount, type SelectorWalletLike } from "./selector-account";

const outcome = (hash: string, burnt = ["100", "200"], failure?: unknown) => ({
  status: failure ? { Failure: failure } : { SuccessValue: "" },
  transaction: { hash },
  transaction_outcome: { id: hash, outcome: { status: { SuccessReceiptId: "x" }, tokens_burnt: burnt[0] } },
  receipts_outcome: [{ id: "r1", outcome: { status: failure ? { Failure: failure } : { SuccessValue: "" }, tokens_burnt: burnt[1] } }],
});

const stakeTx = { receiverId: "astro-stakers.poolv1.near", actions: [{ functionCall: { methodName: "deposit_and_stake", args: {}, gas: 50n * 10n ** 12n, deposit: 10n ** 24n } }] };

function setup(wallet: Partial<SelectorWalletLike>) {
  const functionCall = vi.fn((m: string, args: object, gas: bigint, deposit: bigint) => ({ m, args, gas, deposit }));
  const acc = selectorAccount(wallet as SelectorWalletLike, "alice.near", { rpc: {} as NearRpc, network: "mainnet", functionCall });
  return { acc, functionCall };
}

describe("wallet-selector account adapter", () => {
  it("hands the module's transaction to the wallet unchanged and reads hash and fee from the outcome", async () => {
    const signAndSendTransaction = vi.fn(async () => outcome("HASH1"));
    const { acc, functionCall } = setup({ signAndSendTransaction });
    await expect(acc.sendTransaction(stakeTx)).resolves.toEqual({ hash: "HASH1", fee: 300n });
    expect(functionCall).toHaveBeenCalledWith("deposit_and_stake", {}, 50n * 10n ** 12n, 10n ** 24n);
    expect(signAndSendTransaction).toHaveBeenCalledWith({ signerId: "alice.near", receiverId: "astro-stakers.poolv1.near", actions: [{ m: "deposit_and_stake", args: {}, gas: 50n * 10n ** 12n, deposit: 10n ** 24n }] });
  });

  it("several transactions go out in one wallet prompt", async () => {
    const signAndSendTransactions = vi.fn(async () => [outcome("A"), outcome("B")]);
    const { acc } = setup({ signAndSendTransactions });
    const r = await acc.sendTransactions([stakeTx, { ...stakeTx, receiverId: "zavodil.poolv1.near" }]);
    expect(r.map((x) => x.hash)).toEqual(["A", "B"]);
    expect(signAndSendTransactions).toHaveBeenCalledTimes(1);
  });

  it("refuses anything but contract calls, and transactions for another signer", async () => {
    const { acc } = setup({ signAndSendTransaction: vi.fn() });
    await expect(acc.sendTransaction({ receiverId: "bob.near", actions: [{ transfer: { deposit: 1n } }] })).rejects.toBeInstanceOf(SignerError);
    await expect(acc.sendTransaction({ ...stakeTx, signerId: "mallory.near" })).rejects.toBeInstanceOf(SignerError);
  });

  it("an on-chain failure throws, a rejection is UserRejectedError", async () => {
    const failing = setup({ signAndSendTransaction: vi.fn(async () => outcome("F", ["1", "1"], { ActionError: { kind: "FunctionCallError" } })) });
    await expect(failing.acc.sendTransaction(stakeTx)).rejects.toThrow(/failed on NEAR/);
    const rejecting = setup({ signAndSendTransaction: vi.fn(async () => Promise.reject(new Error("User rejected the request"))) });
    await expect(rejecting.acc.sendTransaction(stakeTx)).rejects.toBeInstanceOf(UserRejectedError);
  });

  it("the demo account only has a chain and an address", async () => {
    const w = watchAccount("nima.near", "mainnet");
    expect(w.chain).toBe("near:mainnet");
    await expect(w.getAddress()).resolves.toBe("nima.near");
    expect("sendTransaction" in w).toBe(false);
    await expect(w.quoteTransfer({} as never)).rejects.toBeInstanceOf(ReadOnlyAccountError);
  });
});
