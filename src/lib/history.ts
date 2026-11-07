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

function save(all: HistoryRecord[], kv: KeyValue | null) {
  try {
    kv?.setItem(KEY, JSON.stringify(all.slice(0, MAX)));
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
