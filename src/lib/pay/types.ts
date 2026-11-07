/** An exact amount to a one-time 1Click deposit address. */
export interface PayInstruction {
  chain: string;
  symbol: string;
  contract: string | null;
  decimals: number;
  amount: string;
  to: string;
  memo: string | null;
  validUntilMs: number;
}

/** A source-chain wallet. `pay` returns the broadcast tx hash. */
export interface Payer {
  family: string;
  label: string;
  address: string;
  pay(p: PayInstruction): Promise<string>;
}

export function familyOf(caip2: string): string {
  const ns = caip2.split(":")[0] ?? "";
  return ns === "eip155" ? "evm" : ns;
}
