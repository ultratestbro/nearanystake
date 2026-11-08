# NearAnyStake

**Stake NEAR from any chain.** Send USDC on Base, SOL, ETH, BTC, USDT on Tron or any of ~40 chains. NEAR Intents
(1Click) delivers native NEAR to your own NEAR account, and one signature stakes it with the validator you pick, or
mints Rhea rNEAR / LiNEAR. Later, unstake with a live epoch countdown, withdraw, and send the NEAR back out to any
chain.

- **Live:** https://nearanystake.vercel.app (NEAR mainnet; dry-run mode until you connect a NEAR wallet)

Built for the NEAR Hackathon 2026, tracks **DeFi** and **Open**. Non-custodial: no contract of ours, no server
holding funds or keys. The app never sees a private key.

## Try it in two minutes (no wallet, nothing to pay)

Dry-run mode is on, also after you connect a NEAR wallet, until you switch it off yourself: real 1Click quotes, real
pools and APRs, no deposit address.

| Do | See |
|---|---|
| Open `/` | Live validator set: stake, fee, APR (from the protocol's own reward data, after the pool's fee), uptime, status. Network APR ≈ 5 %, rNEAR / LiNEAR APR from 7-day price growth, and the epoch clock: **an epoch is ~7 h (measured 6.9–7.1 h), so native unbonding is ~21–28 h** (not 52–60 h). |
| Click **Start staking**, keep *Validator pool*, *USDC on Base*, `5`, press **Get a dry-run quote** | A real 1Click quote: what you send, the native NEAR delivered (and the minimum), the 1Click fee, what a refund would cost, the ETA, and **"✓ echo matches what you approved"**: the response's `quoteRequest` was compared field by field with what you approved. No deposit address is shown. |
| Press **Simulate: delivered** | Statuses shaped like real 1Click answers (labelled *simulated*) move through *Where your funds are now*: Base → NEAR Intents → your NEAR account → the pool. Then the stake step: **Will stake = exactly what was delivered**, capped only by what the account can spend, and **Preflight** shows the exact `deposit_and_stake` transaction the module built (pool, gas, deposit). |
| New quote → **Refunded**, **Exchange took a fee**, **Failed**, **Deadline passed** | Every failure state and what it means for your money (an incomplete deposit is refunded at the deadline; the page keeps checking after it in case 1Click saw a deposit late). |
| Tab **Liquid (rNEAR / LiNEAR)** or **Instant stNEAR** | rNEAR / LiNEAR minted after delivery (refused before quoting when the contract is paused or runs code the module has no pin for); Instant stNEAR offered only when your account exists and is registered on Meta Pool; its quote shows the stNEAR you get. |
| **Positions** → *Demo: nima.near* | A public delegator (on 2026-11-08: **168.9 NEAR unbonding** in `astro-stakers.poolv1.near`): the unlock window as dates and a countdown, Unstake / Withdraw with Preflight. Signing is disabled: it is not your account. |
| **History** | Every quote you requested, with the whole 1Click response including its `signature` (the API asks clients to keep it for disputes), statuses and explorer links. |
| Connect a NEAR wallet (Meteor, HERE, Intear), switch to **Live** | A payable quote with a one-time deposit address, QR, memo when needed and a countdown to when the refund begins (1 h; 3 h for Bitcoin, Zcash, Litecoin, Dogecoin and Bitcoin Cash, and paying stops 5 / 90 min before it); pay once from an EVM, Solana, TON, Tron or Bitcoin wallet, or by hand; then one signature stakes. A brand-new implicit account works: the delivery creates it. |

## How it works

```
your wallet on chain X ──deposit──▶ 1Click / NEAR Intents ──native NEAR──▶ your NEAR account ──deposit_and_stake──▶ pool
                                     (quote echo verified)                 (delivery read on chain)  (exact amount, one signature)
```

1. **Quote.** The browser asks 1Click directly (`access-control-allow-origin: *`, no key) for
   `destinationAsset: nep141:wrap.near`, `recipientType: DESTINATION_CHAIN`, recipient = the connected NEAR account.
   1Click delivers that as native NEAR; a mainnet delivery (tx `AQAkvxyT…`, Oct 2026) created a fresh implicit
   account with the Transfer itself.
2. **Deposit and track.** `/v0/status` every 5 s (once a minute past the deadline): `PENDING_DEPOSIT`,
   `KNOWN_DEPOSIT_TX`, `INCOMPLETE_DEPOSIT`, `PROCESSING`, `SUCCESS`, `REFUNDED`, `FAILED`. The countdown ends when
   the refund begins (the request's deadline), not at the quote's `deadline` (when the address goes inactive,
   72 h later). After a wallet payment the Pay button is gone for good; a flow reopened from History shows nothing
   payable until 1Click answers, and an unknown status is never payable.
3. **Stake.** `amount = min(delivered, getMaxStakeable())`, where delivered is the lower of the Transfer from
   `intents.near` in the NEAR delivery transaction and 1Click's `swapDetails.amountOut`, both read fresh at every
   preflight. The staking module re-checks the pool and balances, shows the exact transaction, and
   `stake({ amount, pool, expected })` refuses if the fresh plan differs from what you saw. NEAR holds back a
   transaction's prepaid gas when it accepts it (bought at `min_gas_purchase_price`, 10× the gas price; refunded
   seconds later), so the module keeps that back too and leaves enough on the account to unstake later (~0.05 NEAR).
   A flow that was staked stays staked when reopened; a wallet error after signing is checked on chain before
   "Sign and stake" comes back.
4. **Exit.** Unstake (an unlocked balance is withdrawn in the same transaction so it never locks again; next to a
   balance still unbonding the module refuses unless you tick "restart the wait"), withdraw when unlocked, then
   **Withdraw to any chain**: NEAR → 1Click → a token on another chain, refunds to your NEAR account. What is shown
   and signed there is the quote (its recipient and token); any edit drops the quote.

## Safety rules the code enforces

- **Stake only what was delivered.** Never "balance minus reserve": an account that already held 1000 NEAR stakes
  only the 0.73 it just received (`src/lib/stakeAmount.ts`, tested).
- **No free-form NEAR recipient.** The NEAR side of every quote is the connected account. The response's
  `quoteRequest` must echo recipient, refund address, assets, amount, swap/recipient/refund/deposit types, `dry` and
  deadline exactly; a deposit address on a dry quote or one that is not an address of the origin chain, a missing
  signature or deadline, a fee to anyone but 1Click's own recipient or above its 20 bps, and a `minAmountOut` below
  the accepted slippage also refuse (`src/lib/oneclick/quote.ts`). The signature is kept for disputes; 1Click
  publishes no key to verify it with.
- **Never `customRecipientMsg`, never `ft_transfer_call` into a liquid staking token.** LiNEAR, rNEAR and stNEAR have
  no `ft_on_transfer`; tokens sent that way are lost. The request builder refuses it, and refuses an LST as an
  outbound destination.
- **Pool allow-list.** Only `*.poolv1.near` / `*.pool.near` ids (checked locally, so a lying RPC can't pass a foreign
  contract off as a pool), one of the four known staking-pool code hashes, `is_staking_paused` answering `false` (a
  missing method is a refusal), fee ≤ 10 % now and as already scheduled for the next epoch, in the current and next
  validator sets. `lst-pool.near` and `meta-pool.near` are refused. Exits only need the suffix and code checks (or
  code the `pool.near` factory allows), so you can always leave a pool that raised its fee or paused.
- **Dry run can't pay.** In dry mode the client refuses to POST `dry: false`, no deposit address is ever rendered,
  and leaving dry mode needs a connected NEAR wallet and the user's own switch (connecting alone keeps it dry).
- **Refunds.** The refund address must be your own wallet (a checkbox unless it came from a connected wallet);
  exchange, memo and minimum-amount warnings (Tron: $100) before you pay.
- **Preflight, not simulation.** NEAR RPC can't dry-run a transaction. Preflight runs the module's quote, which reads
  every precondition fresh, and shows the exact transaction; nothing claims a contract call was executed.

## Any Wallet Kit and baseline disclosure

Staking runs on two new [Any Wallet Kit](https://docs.anywallet.tech) modules, written during the hackathon window
(2026-11-08) and published to npm as 0.1.0 with provenance:

- `@anywalletkit/protocol-staking-native-near`: pools, allow-list, epochs, APR, positions, stake / unstake / withdraw.
- `@anywalletkit/protocol-staking-liquid-near`: LiNEAR and Rhea rNEAR, pinned by contract and code hash.

Their source is the seven commits in https://github.com/ultratestbro/anywalletkit/compare/d9fefda2...c91d06eb
(tags `@anywalletkit/protocol-staking-native-near@0.1.0` and `@anywalletkit/protocol-staking-liquid-near@0.1.0`).

Baseline (existed before the hackathon, by the same author): Any Wallet Kit's `core`, `wallet-near`, `wallet-solana`
and `swap2-assets` packages (npm, Apache-2.0).

**Other hackathon project by the same author: [NearJar](https://nearjar.xyz)**
([github.com/ultratestbro/nearjar](https://github.com/ultratestbro/nearjar)), donation jars for near.com accounts
payable from any chain. The two projects are independent; NearAnyStake reuses NearJar's wallet code (source-chain
payers, wallet-selector setup), the "Pay with" sheet, the route strip, the tactile buttons and the design tokens.

AI disclosure: built with Claude Code.

## Run locally

```sh
pnpm install
pnpm dev            # http://localhost:3501
pnpm test           # vitest: quote echo, dry-run guard, status machine on recorded 1Click answers, stake amount, wallet adapter,
                    # and the staking path on the real modules against a fake NEAR node (what the wallet is asked to sign)
pnpm e2e            # read-only on mainnet: epoch, validators and the allow-list, APRs, a public delegator's positions,
                    # dry 1Click quotes from Base USDC / Solana SOL / Tron USDT with the echo check, and a deposit_and_stake
                    # built (not sent) for the delivered amount. View calls and dry quotes only; E2E_REPORT=file.json saves a report
pnpm typecheck && pnpm lint && pnpm build
```

No environment is needed; see `.env.example` for optional overrides (a Reown project id enables EVM / Solana wallet
connections in the Pay step).

## Layout

- `src/lib/staking.ts`: the only door to the staking modules. It hands out one module instance per account (shared
  caches), with the app's RPCs, nearblocks history for exact unlock epochs and the archival node for liquid APRs.
- `e2e/`: the read-only mainnet checks behind `pnpm e2e`.
- `src/lib/oneclick/`: request builder and echo check, browser client with the dry-run guard, status machine,
  dry-run replay. Recorded 1Click answers in `src/lib/__fixtures__/oneclick/`.
- `src/lib/near/`: wallet-selector setup, the `IWalletAccount` adapter over it, the read-only demo account,
  app-level reads (recipient exists, Meta Pool registration, delivery amount).
- `src/app/api/rpc/[chain]`: read-only RPC proxy for this app's pages only (Origin check, 600 calls a minute per
  client), with failover and a bounded LRU cache for the 375 KB `validators` answer. Set `APP_ORIGINS` for extra
  origins (a custom domain behind a proxy that rewrites Host).

## License

Apache-2.0
