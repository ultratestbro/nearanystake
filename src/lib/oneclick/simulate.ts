// Dry-run replay: status answers shaped like the recorded 1Click ones (fixtures in __fixtures__/oneclick),
// filled from the dry quote. Shown in the UI with a "simulated" label; nothing here touches 1Click.

import type { OneClickStatus, QuoteResponse, StatusResponse, SwapDetails } from "./types";

export type SimOutcome = "success" | "incomplete" | "refunded" | "failed" | "expired";

export const SIM_OUTCOMES: Array<{ id: SimOutcome; label: string }> = [
  { id: "success", label: "Delivered" },
  { id: "incomplete", label: "Exchange took a fee" },
  { id: "refunded", label: "Refunded" },
  { id: "failed", label: "Failed" },
  { id: "expired", label: "Deadline passed" },
];

const empty = (q: QuoteResponse): SwapDetails => ({
  intentHashes: [],
  nearTxHashes: [],
  amountIn: null,
  amountOut: null,
  originChainTxHashes: [],
  destinationChainTxHashes: [],
  refundedAmount: "0",
  refundFee: q.quote.refundFee ?? null,
  withdrawFee: q.quote.withdrawFee ?? null,
});

function at(q: QuoteResponse, status: OneClickStatus, details: Partial<SwapDetails> = {}): StatusResponse {
  return { status, updatedAt: new Date().toISOString(), swapDetails: { ...empty(q), ...details }, quoteResponse: q };
}

/** The status answers a dry run replays, in order, for an outcome. */
export function simulatedStatuses(q: QuoteResponse, outcome: SimOutcome): StatusResponse[] {
  const deposit = { originChainTxHashes: [{ hash: "simulated-deposit" }], depositedAmount: q.quote.amountIn };
  switch (outcome) {
    case "success":
      return [
        at(q, "PENDING_DEPOSIT"),
        at(q, "KNOWN_DEPOSIT_TX", deposit),
        at(q, "PROCESSING", { ...deposit, amountIn: q.quote.amountIn }),
        at(q, "SUCCESS", { ...deposit, amountIn: q.quote.amountIn, amountOut: q.quote.amountOut, amountOutFormatted: q.quote.amountOutFormatted }),
      ];
    case "incomplete": {
      const short = ((BigInt(q.quote.amountIn) * 97n) / 100n).toString();
      return [at(q, "PENDING_DEPOSIT"), at(q, "KNOWN_DEPOSIT_TX", { ...deposit, depositedAmount: short }), at(q, "INCOMPLETE_DEPOSIT", { ...deposit, depositedAmount: short })];
    }
    case "refunded":
      return [
        at(q, "PENDING_DEPOSIT"),
        at(q, "KNOWN_DEPOSIT_TX", deposit),
        at(q, "PROCESSING", deposit),
        at(q, "REFUNDED", { ...deposit, refundedAmount: (BigInt(q.quote.amountIn) - BigInt(q.quote.refundFee ?? "0")).toString(), refundReason: "PRICE_MOVED" }),
      ];
    case "failed":
      return [at(q, "PENDING_DEPOSIT"), at(q, "KNOWN_DEPOSIT_TX", deposit), at(q, "PROCESSING", deposit), at(q, "FAILED", deposit)];
    case "expired":
      return [at(q, "PENDING_DEPOSIT")];
  }
}
