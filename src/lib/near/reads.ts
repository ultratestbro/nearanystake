// App-level NEAR reads that are not staking: does an account exist, is it registered on Meta Pool,
// what did a delivery transaction pay. View calls only.

import { NearRpc, createClient, isImplicitAccountId, isValidAccountId, type NearProvider } from "@anywalletkit/wallet-near";
import { shortAccount } from "../format";
import { transferredTo } from "../stakeAmount";
import { nearProviders } from "./config";

let shared: { rpc: NearRpc; raw: (method: string, params: unknown) => Promise<unknown> } | null = null;

export function nearClient(providers?: NearProvider[]) {
  if (!providers && shared) return shared;
  const fetch = createClient({ provider: providers ?? nearProviders(), timeoutMs: 15_000 });
  if (!fetch) throw new Error("No NEAR RPC configured.");
  const c = { rpc: new NearRpc(fetch), raw: fetch };
  if (!providers) shared = c;
  return c;
}

export type RecipientCheck =
  | { ok: true; exists: boolean; implicit: boolean }
  | { ok: false; error: string };

/**
 * A named account must exist before 1Click can deliver to it (it answers 400 otherwise). A 64-hex
 * implicit account may be new: the delivery's Transfer creates it.
 */
export async function checkRecipient(accountId: string, rpc: NearRpc = nearClient().rpc): Promise<RecipientCheck> {
  if (!isValidAccountId(accountId)) return { ok: false, error: "That is not a NEAR account id." };
  const implicit = isImplicitAccountId(accountId) || /^0x[0-9a-f]{40}$/.test(accountId);
  const view = await rpc.viewAccount(accountId);
  if (!view && !implicit) return { ok: false, error: `${accountId} does not exist on NEAR yet. Create it in your wallet first.` };
  return { ok: true, exists: !!view, implicit };
}

/**
 * Instant stNEAR needs an existing account that is already registered on meta-pool.near: 1Click
 * delivers the token with a plain transfer, and a NEP-141 token can't credit an account that has no
 * storage registered with it.
 */
export async function instantStNearEligible(accountId: string, rpc: NearRpc = nearClient().rpc): Promise<{ ok: boolean; reason: string }> {
  const view = await rpc.viewAccount(accountId).catch(() => undefined);
  if (!view) return { ok: false, reason: `${shortAccount(accountId)} doesn't exist on chain yet, so it couldn't use stNEAR. Use the main flow: its delivery creates the account.` };
  const reg = await rpc.callFunction<unknown>("meta-pool.near", "storage_balance_of", { account_id: accountId }).catch(() => undefined);
  if (reg === undefined) return { ok: false, reason: `Couldn't read the stNEAR registration of ${shortAccount(accountId)} right now.` };
  if (reg === null) return { ok: false, reason: `${shortAccount(accountId)} isn't registered on Meta Pool, so a delivery might not arrive. Use the main flow instead.` };
  return { ok: true, reason: "" };
}

/** NEAR the 1Click delivery transaction transferred to `recipient`, read from the chain; null when unknown. */
export async function deliveredOnChain(txHash: string, recipient: string, raw = nearClient().raw): Promise<bigint | null> {
  try {
    const r = (await raw("EXPERIMENTAL_tx_status", { tx_hash: txHash, sender_account_id: "intents.near", wait_until: "NONE" })) as { receipts?: Parameters<typeof transferredTo>[0] };
    return transferredTo(r.receipts, recipient);
  } catch {
    return null;
  }
}

/** What the account can spend: amount − locked − storage (10^19 yocto per byte), 0n for an account that doesn't exist yet. */
export async function nearSpendable(accountId: string, rpc: NearRpc = nearClient().rpc): Promise<bigint> {
  const v = await rpc.viewAccount(accountId);
  if (!v) return 0n;
  const free = BigInt(v.amount) - BigInt(v.locked) - BigInt(v.storage_usage) * 10n ** 19n;
  return free > 0n ? free : 0n;
}

/** Native balance, 0n for an account that doesn't exist yet. */
export async function nearBalance(accountId: string, rpc: NearRpc = nearClient().rpc): Promise<bigint> {
  const v = await rpc.viewAccount(accountId);
  return v ? BigInt(v.amount) : 0n;
}
