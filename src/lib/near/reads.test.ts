// nearSpendable against wallet-near 0.4.1's own rule (getAvailableBalance), on a fake view_account.

import { NearRpc, NearRpcError, WalletAccountReadOnlyNear, type NearFetch } from "@anywalletkit/wallet-near";
import { describe, expect, it } from "vitest";
import { nearSpendable } from "./reads";

const NEAR = 10n ** 24n;
const BYTE = 10n ** 19n; // storage price per byte

function node(view?: { amount: bigint; locked: bigint; storage: number }): NearFetch {
  return async (method, params) => {
    if (method === "query" && (params as { request_type?: string }).request_type === "view_account") {
      if (!view) throw new NearRpcError("query", { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } });
      return { amount: String(view.amount), locked: String(view.locked), storage_usage: view.storage, code_hash: "11111111111111111111111111111111", block_height: 1, block_hash: "H" };
    }
    throw new Error(`fake node: ${method}`);
  };
}

// an implicit account: wallet-near derives its key from the id, so its read-only account needs no key
const ID = "ab".repeat(32);
const spendable = (v?: Parameters<typeof node>[0]) => nearSpendable(ID, new NearRpc(node(v)));
const walletNear = (v: Parameters<typeof node>[0]) => new WalletAccountReadOnlyNear(ID, { provider: node(v) }).getAvailableBalance();

describe("nearSpendable: amount − max(0, storage − locked)", () => {
  it("an account with no locked balance pays its storage from the amount", async () => {
    const v = { amount: 5n * NEAR, locked: 0n, storage: 182 };
    expect(await spendable(v)).toBe(5n * NEAR - 182n * BYTE);
    expect(await spendable(v)).toBe(await walletNear(v));
  });

  it("a locked (validator) balance pays for storage first and is never subtracted from an amount that excludes it", async () => {
    const v = { amount: 10n * NEAR, locked: 1000n * NEAR, storage: 300_000 };
    // the old amount − locked − storage read 0 here
    expect(await spendable(v)).toBe(10n * NEAR);
    expect(await spendable(v)).toBe(await walletNear(v));
  });

  it("a locked balance below the storage cost leaves only the rest to the amount", async () => {
    const v = { amount: NEAR, locked: 10n ** 21n, storage: 200 }; // 0.001 locked, 0.002 of storage
    expect(await spendable(v)).toBe(NEAR - (200n * BYTE - 10n ** 21n));
    expect(await spendable(v)).toBe(await walletNear(v));
  });

  it("never below zero, and 0 for an account that doesn't exist yet", async () => {
    expect(await spendable({ amount: 10n ** 21n, locked: 0n, storage: 1000 })).toBe(0n);
    expect(await spendable()).toBe(0n);
  });
});
