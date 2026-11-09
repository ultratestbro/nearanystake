// Dry-run mode for judges: real quotes, real pools and APRs, nothing payable.
// Three guards, each enough on its own:
//  1. the 1Click client refuses to POST `dry: false` while the mode is on (oneclick/client.ts);
//  2. the deposit address is never rendered from a dry quote or while the mode is on (below);
//  3. turning the mode off needs a connected NEAR wallet, which then is the only recipient.
// Connecting a wallet turns it off by itself, unless the user picked dry run before (initialDryRun).
// Two places print a live quote's deposit address outside any pay control, on purpose: the "swap
// failed" notice (1Click support looks the swap up by it) and the signed quote in Recent activity,
// which hides it while dry run is on and the quote could still be paid.

import type { QuoteResponse } from "./oneclick/types";

/** The address to show for a deposit, or null when nothing must be shown. */
export function depositAddressToShow(quote: QuoteResponse | null, dryRun: boolean): string | null {
  if (!quote || dryRun || quote.quoteRequest.dry !== false) return null;
  const a = quote.quote.depositAddress;
  return typeof a === "string" && a.length > 0 ? a : null;
}

/** Live mode is possible only with a connected NEAR account (the recipient of every live quote). */
export function canGoLive(nearAccount: string | null): boolean {
  return !!nearAccount;
}

/**
 * The mode after a NEAR wallet connects (or reconnects): live, unless the user switched to dry run
 * before (remembered `true` in this browser). Without a wallet it is always dry.
 */
export function initialDryRun(nearAccount: string | null, remembered: boolean | null): boolean {
  if (!canGoLive(nearAccount)) return true;
  return remembered === true;
}

/**
 * Dry quotes still need a refund address 1Click accepts (it refuses 0x…dEaD and Solana's system
 * program): burn / precompile / zero-hash addresses with valid checksums, a documentation address for
 * Bitcoin and an exchange hot wallet for Zcash. Keyed by the CAIP-2 namespace. Used only when dry and
 * the field is left empty; a dry quote has no deposit address, so nothing can be refunded to them.
 * Each one got a dry quote from 1Click on 2026-11-09. Stellar has none: 1Click wants a memo deposit there.
 */
export const DRY_REFUND: Record<string, string> = {
  eip155: "0x0000000000000000000000000000000000000001",
  solana: "1nc1nerator11111111111111111111111111111111",
  tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  bitcoin: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  ton: "UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ",
  zcash: "t1KfwsnwJeNRVjQGBDZhwKskpQbih2qx5Ua",
  litecoin: "ltc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp9ysmq",
  doge: "D596YFweJQuHY1BbjazZYmAbt8jJPbKehC",
  xrp: "rrrrrrrrrrrrrrrrrrrrrhoLvTp",
  bch: "bitcoincash:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfnhks603",
  cardano: "addr1vyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkdl5mw",
  aptos: "0x0000000000000000000000000000000000000000000000000000000000000001",
  sui: "0x0000000000000000000000000000000000000000000000000000000000000002",
};

/** The dry-run stand-in refund address for a source chain, if it has one. */
export function dryRefundFor(chain: string): string | undefined {
  return DRY_REFUND[chain.split(":")[0]];
}
