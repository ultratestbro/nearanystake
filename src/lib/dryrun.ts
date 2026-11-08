// Dry-run mode for judges: real quotes, real pools and APRs, nothing payable.
// Three guards, each enough on its own:
//  1. the 1Click client refuses to POST `dry: false` while the mode is on (oneclick/client.ts);
//  2. the deposit address is never rendered from a dry quote or while the mode is on (below);
//  3. turning the mode off needs a connected NEAR wallet, which then is the only recipient.
// Connecting a wallet turns it off by itself, unless the user picked dry run before (initialDryRun).

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
 * program): burn / precompile addresses, and a documentation address for Bitcoin. Used only when dry
 * and the field is left empty; a dry quote has no deposit address, so nothing can be refunded to them.
 */
export const DRY_REFUND: Record<string, string> = {
  evm: "0x0000000000000000000000000000000000000001",
  solana: "1nc1nerator11111111111111111111111111111111",
  tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  bitcoin: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
};
