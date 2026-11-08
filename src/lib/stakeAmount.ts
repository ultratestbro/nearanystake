// How much of a delivery gets staked (critique #2): exactly what 1Click delivered for this stake,
// never the account's balance. An account that already held 1000 NEAR stakes only the 0.73 it just
// received. The only cap is what the account can actually spend (available − reserve − fee).

export interface StakeAmountInput {
  /** `swapDetails.amountOut` from 1Click's SUCCESS status, yoctoNEAR. */
  reported: bigint | null;
  /** The Transfer to the account found in the NEAR delivery transaction, when it could be read. */
  onChain: bigint | null;
  /** The module's `getMaxStakeable()` right now. */
  maxStakeable: bigint;
  /** Smallest stake the module sends. */
  minStake: bigint;
}

export interface StakeAmount {
  amount: bigint;
  /** Which figure the amount came from (the lower one when both are known). */
  basis: "on-chain" | "reported";
  /** Both figures are known and differ: the lower one is used. */
  mismatch: boolean;
  /** True when the spendable balance was lower than the delivery (a fresh account pays gas and storage from it). */
  capped: boolean;
  /** True when what is left is below the module's minimum: nothing to stake. */
  tooSmall: boolean;
}

export function stakeAmountAfterDelivery(i: StakeAmountInput): StakeAmount {
  // Neither figure alone can inflate the stake: the on-chain one comes through our RPC proxy and sums
  // every intents.near transfer in the transaction, the reported one is 1Click's word.
  const both = i.onChain !== null && i.reported !== null;
  const onChainLower = i.onChain !== null && (i.reported === null || i.onChain <= i.reported);
  const delivered = onChainLower ? i.onChain : i.reported;
  if (delivered === null) throw new Error("Nothing delivered yet.");
  const basis = onChainLower ? "on-chain" : "reported";
  const mismatch = both && i.onChain !== i.reported;
  if (delivered <= 0n) return { amount: 0n, basis, mismatch, capped: false, tooSmall: true };
  const spendable = i.maxStakeable > 0n ? i.maxStakeable : 0n;
  const amount = delivered < spendable ? delivered : spendable;
  return {
    amount: amount < i.minStake ? 0n : amount,
    basis,
    mismatch,
    capped: amount < delivered,
    tooSmall: amount < i.minStake,
  };
}

interface RpcReceipt {
  predecessor_id?: string;
  receiver_id?: string;
  receipt?: { Action?: { actions?: Array<Record<string, unknown> | string> } };
}

/**
 * Native NEAR the delivery transaction paid the recipient: the Transfer actions from intents.near to
 * `recipient` (gas refunds come from `system` and are not counted).
 */
export function transferredTo(receipts: readonly RpcReceipt[] | undefined, recipient: string, from = "intents.near"): bigint | null {
  if (!receipts) return null;
  let total = 0n;
  let found = false;
  for (const r of receipts) {
    if (r.predecessor_id !== from || r.receiver_id !== recipient) continue;
    for (const a of r.receipt?.Action?.actions ?? []) {
      const t = typeof a === "object" ? (a as { Transfer?: { deposit?: string } }).Transfer : undefined;
      if (t?.deposit && /^\d+$/.test(t.deposit)) {
        total += BigInt(t.deposit);
        found = true;
      }
    }
  }
  return found ? total : null;
}
