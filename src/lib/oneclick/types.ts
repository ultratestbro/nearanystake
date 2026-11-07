// The 1Click API shapes this app uses (https://1click.chaindefuser.com/v0, OpenAPI as of 2026-11).

export type SwapType = "EXACT_INPUT" | "EXACT_OUTPUT";

export interface QuoteRequest {
  dry: boolean;
  swapType: SwapType;
  /** Basis points. */
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  /** Base units of the origin asset (EXACT_INPUT). */
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  /** ISO time after which an unfinished swap is refunded. */
  deadline: string;
  depositMode?: "SIMPLE" | "MEMO";
  quoteWaitingTimeMs?: number;
}

export interface AppFee {
  recipient: string;
  /** Basis points. */
  fee: number;
}

/** The request as 1Click echoes it back: ours, plus fields it filled in. */
export type EchoedQuoteRequest = Partial<QuoteRequest> & {
  appFees?: AppFee[];
  customRecipientMsg?: string;
  [key: string]: unknown;
};

export interface Quote {
  depositAddress?: string | null;
  depositMemo?: string | null;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  minAmountIn?: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd?: string;
  minAmountOut: string;
  /** Absent on dry quotes. */
  deadline?: string;
  timeWhenInactive?: string;
  /** Seconds after the deposit confirms. */
  timeEstimate: number;
  /** Origin-asset base units a refund costs. */
  refundFee?: string;
  /** Destination-asset base units the delivery costs (already in amountOut). */
  withdrawFee?: string;
  customRecipientMsg?: string;
}

export interface QuoteResponse {
  correlationId?: string;
  timestamp: string;
  /** 1Click's signature over the quote: kept with the whole response for disputes. */
  signature: string;
  quoteRequest: EchoedQuoteRequest;
  quote: Quote;
}

export type OneClickStatus = "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

export interface TxDetails {
  hash: string;
  explorerUrl?: string;
}

export interface SwapDetails {
  intentHashes?: string[];
  nearTxHashes?: string[];
  amountIn?: string | null;
  amountInFormatted?: string | null;
  amountOut?: string | null;
  amountOutFormatted?: string | null;
  amountOutUsd?: string | null;
  originChainTxHashes?: TxDetails[];
  destinationChainTxHashes?: TxDetails[];
  refundedAmount?: string | null;
  refundedAmountFormatted?: string | null;
  refundReason?: string | null;
  depositedAmount?: string | null;
  depositedAmountFormatted?: string | null;
  refundFee?: string | null;
  withdrawFee?: string | null;
}

export interface StatusResponse {
  correlationId?: string;
  status: OneClickStatus;
  updatedAt: string;
  swapDetails: SwapDetails;
  quoteResponse?: QuoteResponse;
}

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt?: string;
  contractAddress?: string;
}
