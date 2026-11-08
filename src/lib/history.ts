// Local history: every flow the user started, with the full 1Click quote (signature included, as the
// API asks, for disputes) and every transaction hash. It lives in this browser only.

import type { QuoteResponse, OneClickStatus } from "./oneclick/types";

export type FlowKind = "stake-in" | "instant-stnear" | "withdraw-out";
export type ActionKind = "stake" | "unstake" | "claim";

export interface TxRef {
  chain: string;
  hash: string;
  label: string;
}

export interface FlowRecord {
  id: string;
  type: "flow";
  kind: FlowKind;
  createdAt: number;
  updatedAt: number;
  dry: boolean;
  /** The connected NEAR account (recipient inbound, refund address outbound). */
  account: string;
  /** "native:astro-stakers.poolv1.near", "liquid:rnear", "stnear", or the destination asset outbound. */
  target: string;
  targetLabel: string;
  source: { chain: string; chainLabel: string; symbol: string; decimals: number };
  /** The whole quote response, as 1Click returned it. */
  quote: QuoteResponse;
  status: OneClickStatus | null;
  /** NEAR the stake step staked, yocto string. */
  staked: string | null;
  /** When the app sent the deposit from a connected wallet: the Pay button never comes back after it. */
  paidAt?: number | null;
  /** A stake was signed but its result is unknown (the wallet errored or closed): retrying needs a position check first. */
  stakeAttemptAt?: number | null;
  txs: TxRef[];
}

export interface ActionRecord {
  id: string;
  type: "action";
  kind: ActionKind;
  createdAt: number;
  account: string;
  target: string;
  amount: string;
  txs: TxRef[];
}

export type HistoryRecord = FlowRecord | ActionRecord;

export interface KeyValue {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const KEY = "stake-anywhere.history.v1";
const MAX = 200;

function store(): KeyValue | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
export function onHistory(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function loadHistory(kv: KeyValue | null = store()): HistoryRecord[] {
  try {
    const v = JSON.parse(kv?.getItem(KEY) ?? "[]") as HistoryRecord[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * The newest MAX records. Over the cap, dry quotes go first (oldest first): a live quote's signed
 * response is kept for disputes as long as there is room.
 */
export function trimHistory(all: HistoryRecord[], max = MAX): HistoryRecord[] {
  if (all.length <= max) return all;
  const out = [...all];
  for (let i = out.length - 1; i >= 0 && out.length > max; i--) {
    const r = out[i]!;
    if (r.type === "flow" && r.dry) out.splice(i, 1);
  }
  return out.slice(0, max);
}

function save(all: HistoryRecord[], kv: KeyValue | null) {
  try {
    kv?.setItem(KEY, JSON.stringify(trimHistory(all)));
  } catch {
    // storage full or blocked: the flow still works, it just won't be listed later
  }
  for (const l of listeners) l();
}

export function addRecord(r: HistoryRecord, kv: KeyValue | null = store()): void {
  save([r, ...loadHistory(kv).filter((x) => x.id !== r.id)], kv);
}

export function updateFlow(id: string, patch: Partial<FlowRecord> & { addTx?: TxRef }, kv: KeyValue | null = store()): FlowRecord | null {
  const all = loadHistory(kv);
  const i = all.findIndex((x) => x.id === id && x.type === "flow");
  if (i < 0) return null;
  const cur = all[i] as FlowRecord;
  const { addTx, ...rest } = patch;
  const txs = addTx && !cur.txs.some((t) => t.hash === addTx.hash) ? [...cur.txs, addTx] : cur.txs;
  const next: FlowRecord = { ...cur, ...rest, txs, updatedAt: Date.now() };
  all[i] = next;
  save(all, kv);
  return next;
}

export function getFlow(id: string, kv: KeyValue | null = store()): FlowRecord | null {
  const r = loadHistory(kv).find((x) => x.id === id);
  return r?.type === "flow" ? r : null;
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
