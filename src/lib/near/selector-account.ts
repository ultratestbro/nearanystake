// An Any Wallet Kit account over a wallet-selector wallet (NEAR-STAKING-API §4.1). The staking
// modules build the exact transactions; this hands them to the user's wallet unchanged, one prompt per
// write (several transactions go out with one signAndSendTransactions prompt).

import {
  ReadOnlyAccountError, SignerError, UserRejectedError,
  type IWalletAccount, type IWalletAccountReadOnly, type Receipt, type TransferResult, type WriteOptions,
} from "@anywalletkit/core";
import { WalletAccountReadOnlyNear, outcomeFailed, type NearAction, type NearRpc, type NearTransaction, type RawFinalOutcome } from "@anywalletkit/wallet-near";
import type { NearNetwork } from "./config";

/** The two wallet-selector calls the adapter uses (structural, so tests need no wallet). */
export interface SelectorWalletLike {
  signAndSendTransaction(params: { signerId?: string; receiverId?: string; actions: unknown[] }): Promise<unknown>;
  signAndSendTransactions(params: { transactions: Array<{ signerId?: string; receiverId: string; actions: unknown[] }> }): Promise<unknown>;
}

/** wallet-selector 10 wants near-api-js Action objects: `actionCreators.functionCall`. */
export type FunctionCallFactory = (methodName: string, args: object, gas: bigint, deposit: bigint) => unknown;

export interface NearTransactionsSender {
  sendTransactions(transactions: NearTransaction[], options?: WriteOptions): Promise<TransferResult[]>;
}

export type SelectorAccount = IWalletAccount & NearTransactionsSender;

/** What failed outcomes and rejections look like coming back from Meteor / HERE / Intear. */
function mapError(e: unknown): Error {
  const m = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel|closed|user/i.test(m) && !/insufficient/i.test(m)) return new UserRejectedError(m || "You cancelled in the wallet.");
  return e instanceof Error ? e : new Error(m);
}

function resultOf(outcome: unknown): TransferResult {
  const o = (outcome ?? {}) as RawFinalOutcome;
  const failed = outcomeFailed(o);
  if (failed) throw new Error(`The transaction failed on NEAR: ${failed}`);
  const hash = o.transaction?.hash ?? o.transaction_outcome?.id;
  if (!hash) throw new Error("The wallet did not return the transaction.");
  let fee = 0n;
  for (const x of [o.transaction_outcome, ...(o.receipts_outcome ?? [])]) {
    const t = x?.outcome?.tokens_burnt;
    if (t && /^\d+$/.test(t)) fee += BigInt(t);
  }
  return { hash, fee };
}

export function selectorAccount(
  wallet: SelectorWalletLike,
  accountId: string,
  deps: { rpc: NearRpc; network: NearNetwork; functionCall: FunctionCallFactory },
): SelectorAccount {
  const chain = `near:${deps.network}`;

  const actionsOf = (tx: NearTransaction): unknown[] => {
    if (tx.signerId !== undefined && tx.signerId !== accountId) throw new SignerError(`This transaction is for ${tx.signerId}, not the connected ${accountId}.`);
    return tx.actions.map((a: NearAction) => {
      if (!("functionCall" in a)) throw new SignerError("Only contract calls are signed here.");
      const f = a.functionCall;
      if (f.args instanceof Uint8Array || typeof f.args === "string") throw new SignerError("Contract arguments must be JSON.");
      return deps.functionCall(f.methodName, f.args, BigInt(f.gas ?? 30n * 10n ** 12n), BigInt(f.deposit ?? 0n));
    });
  };

  const readOnly: IWalletAccountReadOnly = {
    chain,
    getAddress: async () => accountId,
    getBalance: async () => {
      const v = await deps.rpc.viewAccount(accountId);
      return v ? BigInt(v.amount) : 0n;
    },
    getTokenBalance: async (token: string) => BigInt((await deps.rpc.callFunction<string>(token, "ft_balance_of", { account_id: accountId })) ?? "0"),
    quoteSendTransaction: async (tx: unknown) => ({ fee: WalletAccountReadOnlyNear.gasOf((tx as NearTransaction).actions, false) * (await deps.rpc.gasPrice()) }),
    quoteTransfer: async () => {
      throw new SignerError("Plain transfers are not sent from this app.");
    },
    getTransactionReceipt: async (hash: string): Promise<Receipt | undefined> => {
      const o = await deps.rpc.txStatus(hash, accountId);
      return o ? { hash, status: outcomeFailed(o) ? 0 : 1 } : undefined;
    },
    verify: async () => false,
  };

  return {
    ...readOnly,
    needsNetwork: true,
    async sign() {
      throw new SignerError("not supported by this wallet");
    },
    async signTransaction() {
      throw new SignerError("not supported by this wallet");
    },
    async transfer() {
      throw new SignerError("Plain transfers are not sent from this app.");
    },
    async sendTransaction(tx: unknown): Promise<TransferResult> {
      const t = tx as NearTransaction;
      const actions = actionsOf(t);
      let outcome: unknown;
      try {
        outcome = await wallet.signAndSendTransaction({ signerId: accountId, receiverId: t.receiverId, actions });
      } catch (e) {
        throw mapError(e);
      }
      return resultOf(outcome);
    },
    async sendTransactions(txs: NearTransaction[]): Promise<TransferResult[]> {
      const transactions = txs.map((t) => ({ signerId: accountId, receiverId: t.receiverId, actions: actionsOf(t) }));
      let outcomes: unknown;
      try {
        outcomes = await wallet.signAndSendTransactions({ transactions });
      } catch (e) {
        throw mapError(e);
      }
      if (!Array.isArray(outcomes) || outcomes.length !== txs.length) throw new Error("The wallet did not return every transaction.");
      return outcomes.map(resultOf);
    },
    toReadOnlyAccount: () => readOnly,
    dispose() {},
  };
}

/**
 * A read-only account for the demo: just a chain and an address. The modules read nothing else, and
 * every write refuses with ReadOnlyAccountError before anything is built.
 */
export function watchAccount(accountId: string, network: NearNetwork): IWalletAccountReadOnly {
  const no = (m: string) => async () => {
    throw new ReadOnlyAccountError(m);
  };
  return {
    chain: `near:${network}`,
    getAddress: async () => accountId,
    getBalance: async () => 0n,
    getTokenBalance: async () => 0n,
    quoteSendTransaction: async () => ({ fee: 0n }),
    quoteTransfer: no("quoteTransfer"),
    getTransactionReceipt: async () => undefined,
    verify: async () => false,
  };
}
