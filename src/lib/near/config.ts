import { NearRpcError, createClient, type NearFetch, type NearProvider } from "@anywalletkit/wallet-near";

export type NearNetwork = "mainnet" | "testnet";

/** The app runs on mainnet (1Click has no testnet). */
export const NEAR_NETWORK: NearNetwork = "mainnet";
export const NEAR_CHAIN = `near:${NEAR_NETWORK}` as const;

export const PUBLIC_RPC = process.env.NEXT_PUBLIC_NEAR_RPC_URL || "https://free.rpc.fastnear.com";
export const ARCHIVAL_RPC = "https://archival-rpc.mainnet.fastnear.com";
/** Second public node, for when the free tier answers 429 (rpc.mainnet.near.org is retired). */
export const FALLBACK_RPC = "https://near.drpc.org";

/**
 * Reads go through our caching proxy first (the 375 KB validators answer is cached there), then
 * straight to the public node. A lying proxy cannot pass a foreign contract off as a pool: the
 * modules check pool ids and code hashes locally.
 */
export function nearProviders(): NearProvider[] {
  if (typeof window === "undefined") return [serverClient()];
  return [`${window.location.origin}/api/rpc/near`, PUBLIC_RPC, FALLBACK_RPC];
}

/**
 * Outside the browser (`pnpm e2e`) there is no proxy, so this does what the proxy does: fail over
 * between its three nodes, and when all of them refuse, pause and go round again. One pass is not
 * enough: both FastNEAR nodes answer 429 together (one per-IP limit), and dRPC often answers
 * `gas_price` with UNKNOWN_BLOCK (HTTP 422). The server never signs, so every call here is a read.
 */
function serverClient(): NearFetch {
  const client = createClient({ provider: [PUBLIC_RPC, "https://rpc.mainnet.fastnear.com", FALLBACK_RPC] })!;
  return async (method, params) => {
    for (let pass = 1; ; pass++) {
      try {
        return await client(method, params);
      } catch (e) {
        // a node's own answer (unknown account, a failed view call) is final; only "every node refused" is retried
        if (e instanceof NearRpcError || pass === 3) throw e;
        await new Promise((r) => setTimeout(r, pass * 1_000));
      }
    }
  };
}

/** A public account with NEAR in a staking pool, read-only: the demo for judges (a third party's account, never the author's). */
export const DEMO_ACCOUNT = process.env.NEXT_PUBLIC_DEMO_ACCOUNT || "nima.near";

/** Suggested pool when the user has not picked one (a 1 % fee pool); the picker lists every eligible one. */
export const SUGGESTED_POOL = process.env.NEXT_PUBLIC_SUGGESTED_POOL || "astro-stakers.poolv1.near";

export const NEAR_EXPLORER_TX = "https://nearblocks.io/txns/";
export const NEAR_EXPLORER_ACCOUNT = "https://nearblocks.io/address/";

/** Source-chain explorers, by CAIP-2 id. */
export const EXPLORERS: Record<string, string> = {
  "eip155:1": "https://etherscan.io/tx/",
  "eip155:8453": "https://basescan.org/tx/",
  "eip155:42161": "https://arbiscan.io/tx/",
  "eip155:10": "https://optimistic.etherscan.io/tx/",
  "eip155:56": "https://bscscan.com/tx/",
  "eip155:137": "https://polygonscan.com/tx/",
  "eip155:43114": "https://snowtrace.io/tx/",
  "eip155:100": "https://gnosisscan.io/tx/",
  "solana:mainnet": "https://solscan.io/tx/",
  "tron:728126428": "https://tronscan.org/#/transaction/",
  "ton:-239": "https://tonviewer.com/transaction/",
  "near:mainnet": NEAR_EXPLORER_TX,
  "bitcoin:mainnet": "https://mempool.space/tx/",
  "zcash:mainnet": "https://blockchair.com/zcash/transaction/",
  "doge:mainnet": "https://blockchair.com/dogecoin/transaction/",
};

export function explorerTx(chain: string, hash: string): string | null {
  const base = EXPLORERS[chain];
  return base ? base + hash : null;
}
