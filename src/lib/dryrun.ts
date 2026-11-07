// Dry-run mode for judges: real quotes, real pools and APRs, nothing payable.
// Three guards, each enough on its own:
//  1. the 1Click client refuses to POST `dry: false` while the mode is on (oneclick/client.ts);
//  2. the deposit address is never rendered from a dry quote or while the mode is on (below);
//  3. turning the mode off needs a connected NEAR wallet, which then is the only recipient.

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

/** The mode a page starts in: dry until a wallet is connected, unless the user chose otherwise. */
export function initialDryRun(nearAccount: string | null, remembered: boolean | null): boolean {
  if (!nearAccount) return true;
  return remembered ?? false;
}
