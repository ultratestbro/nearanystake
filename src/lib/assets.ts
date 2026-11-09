import { CC_SOURCE_CHAINS } from "@anywalletkit/swap2-assets";
import { payerFamily, type SourceFamily } from "./pay";

export interface SourceAsset {
  chain: string; // CAIP-2
  chainLabel: string;
  chainIcon: string;
  symbol: string;
  /** 1Click / intents.near asset id. */
  assetId: string;
  /** Token contract / mint / jetton master; null = the chain's native coin. */
  contract: string | null;
  decimals: number;
  icon: string;
  /** Which wallet can pay it from here; null = send it by hand. */
  family: SourceFamily | null;
}

/** Catalog tokens 1Click doesn't list (its /v0/tokens on 2026-11-09): every quote answers "tokenIn is not valid". */
const NOT_ON_1CLICK = new Set([
  "nep141:eth-0xae7ab96520de3a18e5e111b5eaab095312d7fe84.omft.near", // stETH on Ethereum
  "nep141:eth-0x9d65ff81a3c488d585bbfb0bfe3c7707c7917f54.omft.near", // SSV on Ethereum
]);

const ALL: SourceAsset[] = CC_SOURCE_CHAINS.flatMap((c) =>
  c.assets
    .filter((a) => a.assetId && !NOT_ON_1CLICK.has(a.assetId))
    .map((a) => ({
      chain: c.caip2,
      chainLabel: c.label,
      chainIcon: c.icon ?? "",
      symbol: a.symbol,
      assetId: a.assetId,
      contract: a.contract ?? null,
      decimals: a.decimals,
      icon: a.icon ?? c.icon ?? "",
      family: payerFamily(c.caip2),
    })),
);

/** What a stake can be paid with: every catalog token 1Click routes, on every chain but NEAR itself. */
export const SOURCE_ASSETS: SourceAsset[] = ALL.filter((a) => a.chain !== "near:mainnet");

/** Where "Cash out to any chain" can deliver: the same tokens. */
export const DESTINATION_ASSETS: SourceAsset[] = SOURCE_ASSETS;

export const PINNED_CHAINS = ["eip155:8453", "solana:mainnet", "eip155:1", "eip155:42161", "tron:728126428", "ton:-239", "bitcoin:mainnet"];

export const NEAR_ICON = ALL.find((a) => a.chain === "near:mainnet" && a.symbol === "NEAR")?.icon ?? "https://s2.coinmarketcap.com/static/img/coins/128x128/6535.png";

export function findAsset(chain: string, symbol: string): SourceAsset | undefined {
  return SOURCE_ASSETS.find((a) => a.chain === chain && a.symbol === symbol);
}

/** Chains whose deposits need a memo (exchanges often can't add one). */
export const MEMO_CHAINS = new Set(["stellar:pubnet", "xrp:mainnet", "cosmos:cosmoshub-4", "ton:-239"]);

/** Temporary 1Click minimums seen on 2026-11-08 (Tron: $100); the quote's own refusal is authoritative. */
export const KNOWN_MINIMUM_USD: Record<string, number> = { "tron:728126428": 100 };

/** A plausible address for the chain, before 1Click validates it (catches pasting the wrong kind). */
export function looksLikeAddress(chain: string, a: string): boolean {
  const s = a.trim();
  if (chain.startsWith("eip155:")) return /^0x[0-9a-fA-F]{40}$/.test(s);
  if (chain === "solana:mainnet") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  if (chain === "tron:728126428") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s);
  if (chain === "bitcoin:mainnet") return /^(bc1[0-9a-z]{25,62}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(s);
  if (chain === "ton:-239") return /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(s) || /^-?\d:[0-9a-fA-F]{64}$/.test(s);
  return s.length >= 20 && !/\s/.test(s);
}
