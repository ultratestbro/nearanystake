# NearAnyStake

**Stake NEAR from any chain.** Pay with a token you already hold on one of 25 chains (69 tokens: USDC on Base, SOL,
ETH, BTC, USDT on Tron, …). NEAR Intents (1Click) delivers native NEAR to your own NEAR account, and one signature
stakes exactly what arrived into the validator pool you pick, or mints Rhea rNEAR / LiNEAR (or 1Click delivers Meta
Pool stNEAR directly: *Instant stNEAR*). Later, unstake with a live epoch countdown, withdraw, and cash the NEAR out
to any chain.

**Problem it solves:** holding USDC on Base, SOL or another chain but wanting to stake NEAR normally means a bridge or
an exchange first, then a transfer to a NEAR wallet, then staking; here it is one quote, one payment and one
signature, and the NEAR lands in your own account.

- **Live:** https://nearanystake.xyz (NEAR mainnet; dry-run mode until you connect a NEAR wallet)
- **Code:** https://github.com/ultratestbro/nearanystake, Apache-2.0 (`LICENSE`)

Built for the NEAR Hackathon 2026, tracks **DeFi** and **Open**. Non-custodial: no contract of ours, no server
holding funds or keys. The app never sees a private key.

## Try it

### Without a wallet (nothing to pay)

Dry-run mode: real 1Click quotes, real pools and APRs, no deposit address. Quotes deliver to the public demo account
`nima.near`, a third party's account whose balance and positions change; a figure with a date is an example from that day.

| # | Do | See |
|---|---|---|
| 1 | Open https://nearanystake.xyz/ | **Native staking APR** (the network's gross APR from the protocol's own reward data × 0.95, i.e. after a typical 5 % pool fee; the gross figure is in the hint), **Rhea rNEAR** and **LiNEAR** APR (7-day price growth), **Native unbonding 21–28 h**. Under **Validators**: the epoch clock (the epoch length measured on chain, ~6.8 h on 2026-11-09, not 12 h, and when a native unstake started now would unlock) and the live validator list: stake, fee, APR after the pool's fee, uptime, status (**Verified**, or why not, e.g. **Fee too high**), and **Stake** on each eligible pool. |
| 2 | Click **Start staking** (`/stake`) | One card, prefilled (two columns on a wide screen, one on a phone). **You pay** `5` with the token chip **USDC · Base** (opens **Pay with**: 69 tokens on 25 chains) and quick amounts **$5** / **$20** / **$50** / **$100**. **You stake into**: **Validator** / **rNEAR** / **LiNEAR** with their APRs, the pool row (`astro-stakers`, **Verified**; click it to **Pick a validator** among the eligible ones) and **Instant stNEAR · costs more**. **You get**: ≈ NEAR staked, ≈ NEAR earned a year, when it unlocks after unstaking. **Details** (closed: *To a demo account (dry run)*): *NEAR goes to* `nima.near` (*the demo account, dry run*), *Kept on your account* (the gas reserve: *≈ 0.1661 NEAR for gas, so you can unstake later* on 2026-11-09; in a dry run it is the same for any amount), *If anything fails* (*Nothing to refund in a dry run*), *Pool fee*. Main button **Connect NEAR wallet**, under it **Get a dry-run quote · nothing to pay**. |
| 3 | Press **Get a dry-run quote · nothing to pay** | The same card becomes the dry-run quote with 1Click's exact numbers: **You get** ≈ NEAR staked (the delivery minus the gas reserve kept on the account). **Details** (its summary: fee and ETA): *Swap fee (NEAR Intents)*, *Arrives in*, *NEAR goes to* (≈ amount and the minimum), *Kept on your account*, *If anything fails* (refund address, a placeholder in a dry run, and what a refund costs), *Pool fee*, and **Quote check: Matches what you asked for** (the response's `quoteRequest` compared field by field with the request). No deposit address. Buttons: **Play the next steps (simulated)**, the chips under **Or try another outcome**, and **Start over with a new quote**. |
| 4 | Press **Play the next steps (simulated)** | The card turns into a tracker, *Simulated stake of 5 USDC*, badge **Simulation**: the route USDC on Base → NEAR Intents → `nima.near` → the pool, and timed steps. The stake step, *In a live run: sign to stake … NEAR*, shows **Delivered** and **Will stake**: in a simulation the delivery minus a new account's storage and the gas reserve; in a live run exactly what was delivered, capped only by what the account can spend. **What you'll sign** shows the `deposit_and_stake` transaction the staking module built (pool, gas, deposit) and what stays on the account for the unstake (0.1094 NEAR on 2026-11-09). The sign button reads **Connect NEAR wallet to stake for real**. The preview runs on the demo account's own balance (about 6 NEAR on 2026-11-09): for an amount that account can't cover, a **Preflight on the demo account** notice replaces the transaction preview. |
| 5 | **Start a new stake** (back to the form), **Get a dry-run quote · nothing to pay** again, then a chip under **Or try another outcome**: **Exchange took a fee**, **Refunded**, **Failed** or **Deadline passed** | The tracker plays that outcome and says what it means for the money: *Less than quoted arrived* (1Click refunds it at the deadline, minus the refund fee), *Refunded* (amount and reason), *1Click reports the swap failed* (in a live run: check the refund address, then contact 1Click support), *Deadline passed* (anything sent is refunded; in a live run the page keeps asking 1Click once a minute in case it saw a deposit late). After the last three, **Try again with a new quote** leads back to the form. |
| 6 | Pick **rNEAR** or **LiNEAR**, or click **Instant stNEAR · costs more** | rNEAR / LiNEAR: the token row (*Rhea rNEAR* / *LiNEAR*, with 1 token = … NEAR) is **Verified** when the contract runs pinned code and neither it nor its deposits or staking are paused (rNEAR can pause those on their own; otherwise **Paused** / **Unknown code**, and quoting is refused); **You get** shows the tokens at their current price. A first rNEAR stake keeps 0.00125 NEAR for the account's token registration, and the simulated stake step says so (*First stake into Rhea Liquid Near Staking Token: the contract keeps 0.00125 NEAR …*; `nima.near` held no rNEAR on 2026-11-09). Instant stNEAR (*Meta Pool stNEAR*) needs a recipient registered on Meta Pool: an unregistered one gets **Not available** and no quote (`nima.near` was not registered on 2026-11-09). |
| 7 | **Portfolio** → **View a demo account** (`/portfolio?view=demo`, also **See a demo account** on the home page; `/positions` redirects to Portfolio) | The read-only portfolio of `nima.near`, marked **Demo**: a total and its state, *Next epoch* (*Next reward* while NEAR is staked) / *Unstaking* / *Ready to withdraw*, one card per position showing where it is (Staked → Unstaking with a countdown → Ready to withdraw → Back on your account) and only the actions that fit that state: **Unstake** for staked NEAR, **Withdraw** for unstaked NEAR, **Withdraw** opening a preview of the exact transaction and **Unstake** a dialog whose **Preview** builds it (or either giving the reason it can't run yet, e.g. still unbonding), with the sign button disabled (*Read-only*). Which buttons show depends on the account's state at the time: on 2026-11-09 it had ~168.9 NEAR unstaked and withdrawable in `astro-stakers.poolv1.near`, so its card offered only **Withdraw**, with a `withdraw_all` preview. |
| 8 | **Portfolio** → **Recent activity** (`/history` redirects here) | What this browser did, newest first, in plain words with a state (*Done*, *In progress*, *Needs your signature*, *Refunded*, *Dry run*, …). Dry-run quotes collapse into one **Dry run** row. Live flows add each transaction as a labelled explorer link, **Open status** to reopen the tracker, and **Signed quote (keep for disputes)**: the whole 1Click response including its `signature`. |

### With a NEAR wallet (mainnet, real funds)

| # | Do | See |
|---|---|---|
| 9 | **Connect NEAR** in the header (Meteor, HERE or Intear) | The header switch turns to **Live** (unless you picked dry run before in this browser) and quotes deliver to your account. A live quote has a one-time deposit address, QR, memo when needed, and a **Refund deadline**, when the refund begins (1 h; 3 h for Bitcoin, Zcash, Litecoin, Dogecoin and Bitcoin Cash; paying stops 5 / 90 min before it). Pay once from an EVM, Solana, TON, Tron or Bitcoin wallet, or by hand; the tracker follows 1Click, then one signature (**Sign and stake**) stakes exactly what arrived. A brand-new implicit account works: the delivery creates it. |
| 10 | **Portfolio** with your account | Your positions with **Unstake** / **Withdraw** that sign real transactions, and **Cash out to any chain** under *Available on your account*: NEAR → 1Click → a token on another chain, refunds to your NEAR account. |

## How it works

```
your wallet on chain X ──deposit──▶ 1Click / NEAR Intents ──native NEAR──▶ your NEAR account ──deposit_and_stake──▶ pool
                                     (quote echo verified)                 (delivery read on chain)  (exact amount, one signature)
```

1. **Quote.** The browser asks 1Click directly (`access-control-allow-origin: *`, no key) for
   `destinationAsset: nep141:wrap.near`, `recipientType: DESTINATION_CHAIN`, recipient = the connected NEAR account.
   1Click delivers that as native NEAR; a mainnet delivery on 2026-10-10
   ([`AQAkvxyT2N2WzZ5LzwZvcw139WHG2JGAvVLqBdVYUttX`](https://nearblocks.io/txns/AQAkvxyT2N2WzZ5LzwZvcw139WHG2JGAvVLqBdVYUttX))
   created a fresh implicit account with the Transfer itself.
2. **Deposit and track.** `/v0/status` every 5 s (once a minute past the deadline): `PENDING_DEPOSIT`,
   `KNOWN_DEPOSIT_TX`, `INCOMPLETE_DEPOSIT`, `PROCESSING`, `SUCCESS`, `REFUNDED`, `FAILED`. The countdown ends when
   the refund begins (the request's deadline), not at the quote's `deadline` (when the address goes inactive,
   72 h later). After a wallet payment no Pay button shows unless you say the payment failed in your wallet; a flow
   reopened from Recent activity shows nothing payable until 1Click answers, and an unknown status is never payable.
3. **Stake.** `amount = min(delivered, getMaxStakeable())`, where delivered is the lower of the Transfer from
   `intents.near` in the NEAR delivery transaction and 1Click's `swapDetails.amountOut`, both read fresh at every
   preflight. The staking module re-checks the pool and balances, shows the exact transaction, and
   `stake({ amount, pool, expected })` refuses if the fresh plan differs from what you saw. NEAR holds back a
   transaction's prepaid gas when it accepts it (bought at `min_gas_purchase_price`, 10× the gas price; refunded
   seconds later), so the module keeps that back too and leaves enough on the account for the largest exit, an
   unstake that withdraws an unlocked balance in the same transaction (`[withdraw_all, unstake]`: 0.1094 NEAR on
   2026-11-09). The app's own previews (*Kept on your account*, the simulated stake) use the same rule
   (`exitReserve` in `src/lib/staking.ts`, checked against the module's `quote.reserve` in the tests and the e2e).
   A flow that was staked stays staked when reopened; a wallet error after signing is checked on chain before
   "Sign and stake" comes back.
4. **Exit.** Unstake (an unlocked balance is withdrawn in the same transaction so it never locks again; next to a
   balance still unbonding the module refuses unless you tick "restart the wait"; if the account can't pay the gas of
   both calls, the module refuses with `claim-first` and the dialog offers **Withdraw … first**), withdraw when
   unlocked, then **Cash out to any chain** (Portfolio → *Available on your account*): NEAR → 1Click → a token on
   another chain, refunds to your NEAR account; it keeps the same exit reserve on the account. What is shown and
   signed there is the quote (its recipient and token); any edit drops the quote. Exits don't depend on the
   validator set or the epoch: when those can't be read, the unstake still goes out and the dialog says *Unlock time
   unknown*.

## Where NEAR is used

Mainnet only (1Click has no testnet).

- **NEAR Intents, 1Click API** (`src/lib/oneclick/`), called from the browser: `POST /v0/quote` (inbound: any
  source token → `nep141:wrap.near` with `recipientType: DESTINATION_CHAIN`, which 1Click delivers as native NEAR;
  `nep141:meta-pool.near` for Instant stNEAR; outbound: wNEAR → a token on another chain), `GET /v0/status`,
  `POST /v0/deposit/submit` (the deposit hash after a wallet payment), `GET /v0/tokens` (prices).
- **The delivery, read on chain:** `EXPERIMENTAL_tx_status` of 1Click's delivery transaction, summing the native
  `Transfer`s from `intents.near` to the account (`src/lib/near/reads.ts`, `src/lib/stakeAmount.ts`).
- **Validator pools** `*.poolv1.near` / `*.pool.near`, through `@anywalletkit/protocol-staking-native-near`: calls
  `deposit_and_stake`, `unstake` / `unstake_all` (after `withdraw_all` in the same transaction when a balance is
  already unlocked) and `withdraw_all`; view calls `get_account`, `get_reward_fee_fraction`, `get_pool_summary`
  (the fee already scheduled for the next epoch, on `*.pool.near` pools), `is_staking_paused`, the pool's code hash
  (`view_account`), the `validators` RPC (stake, uptime, last epoch's rewards for the APR and the epoch clock),
  `EXPERIMENTAL_protocol_config` and `gas_price` (the fee model).
- **Liquid staking**, through `@anywalletkit/protocol-staking-liquid-near`: Rhea `lst.rhealab.near` (rNEAR) and
  `linear-protocol.near` (LiNEAR), pinned by account and code hash: `deposit_and_stake`, `unstake` / `unstake_all`,
  `withdraw_all`; view calls `ft_price` (also at a block 7 days back, on the archival node, for the APR),
  `get_summary`, `get_account_details`, `ft_balance_of`, `is_paused`, `pa_all_paused` (rNEAR's per-feature pauses),
  `storage_balance_of` and `storage_balance_bounds` (what a first rNEAR stake keeps for registration).
- **Meta Pool** `meta-pool.near`: `storage_balance_of` decides whether Instant stNEAR is offered; 1Click delivers the
  stNEAR itself.
- **Cash out:** one transaction to `wrap.near` (`storage_deposit`, `near_deposit`, `ft_transfer` to 1Click's
  one-time deposit account).
- **Wallets:** NEAR Wallet Selector 10 with Meteor, HERE and Intear (full-access signatures, no function-call key);
  the wallet gets the module's transaction unchanged (`src/lib/near/selector-account.ts`).

## Safety rules the code enforces

- **Stake only what was delivered.** Never "balance minus reserve": an account that already held 1000 NEAR stakes
  only the 0.73 it just received (`src/lib/stakeAmount.ts`, tested).
- **No free-form NEAR recipient.** The NEAR side of every quote is the connected account. The response's
  `quoteRequest` must echo recipient, refund address, assets, amount, swap/recipient/refund/deposit types, slippage,
  `dry` and deadline (to the second); a deposit address on a dry quote or one that is not an address of the origin chain, a missing
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
  and leaving dry mode needs a connected NEAR wallet, which is then the only recipient. Connecting one switches to
  live unless the user picked dry run before (remembered in this browser); the switch stays in the header.
- **Refunds.** The refund address must be your own wallet (a checkbox unless it came from a connected wallet);
  exchange, memo and minimum-amount warnings (Tron: $100) before you pay.
- **Preflight, not simulation.** NEAR RPC can't dry-run a transaction. Preflight runs the module's quote, which reads
  every precondition fresh, and shows the exact transaction; nothing claims a contract call was executed.

## Libraries, services and baseline

**Any Wallet Kit staking modules, written during the hackathon.** Staking runs on two new
[Any Wallet Kit](https://docs.anywallet.tech) modules by the same author:

- `@anywalletkit/protocol-staking-native-near` 0.2.0: pools, allow-list, epochs, APR, positions, stake / unstake /
  withdraw.
- `@anywalletkit/protocol-staking-liquid-near` 0.1.1: LiNEAR and Rhea rNEAR, pinned by contract and code hash.

Their source is the nine commits in https://github.com/ultratestbro/anywalletkit/compare/d9fefda2...a1dccb2f,
authored 2026-11-07 21:45 UTC – 2026-11-08 16:40 UTC. Their 0.1.0 releases (release commit `c91d06eb`, which also
released an unrelated package, `@anywalletkit/protocol-swap2-usdt0` 0.4.3) were published to npm on 2026-11-08 around
15:00 UTC. The versions used here add the review fixes of `dd93115c` (2026-11-08 16:39 UTC): a stake reserve sized for
`[withdraw_all, unstake]` with the `claim-first` refusal, exits that don't depend on validator or epoch reads
(`unlock: null`), no unstake that leaves dust, the scheduled-fee check on every `*.pool.near` pool, rNEAR's first-stake
storage fee and per-feature pauses, and spendable = amount − max(0, storage − locked). Release commit `a1dccb2f`. The
tags (`@anywalletkit/protocol-staking-native-near@0.2.0`, `@anywalletkit/protocol-staking-liquid-near@0.1.1`,
`@anywalletkit/wallet-near@0.4.1`) and the npm provenance of all three point to `209dd702` (2026-11-08 16:48 UTC), the
next commit on main, which CI published from; it only relaxes a test's time limit in an unrelated package
(`packages/kit`), so the published code is that of `a1dccb2f`. All three were published to npm with provenance on
2026-11-08 around 17:00 UTC.

**Baseline.** Any Wallet Kit ([github.com/ultratestbro/anywalletkit](https://github.com/ultratestbro/anywalletkit),
`@anywalletkit/*` on npm), an open wallet SDK by the same author (Apache-2.0), is used here as a library. The
pre-hackathon baseline is SDK commit
[`77df2e37`](https://github.com/ultratestbro/anywalletkit/tree/77df2e3747adc8d8c7badccd81ddaaa3200c8038)
(2026-10-18), the last one before the 2026-10-19 announcement; its packages were then named `@forgewallet/*`. The SDK
kept being developed during the window
([changes since the baseline](https://github.com/ultratestbro/anywalletkit/compare/77df2e37...main)): the
`@anywalletkit/*` packages were first published to npm on 2026-10-24. The general-purpose packages used here, as
pinned during the window:

| Package | Pinned | Published to npm |
|---|---|---|
| `@anywalletkit/core` | 0.8.0 | 2026-11-02 |
| `@anywalletkit/wallet-near` | 0.4.1 (the spendable-balance fix of `dd93115c`) | 2026-11-08 |
| `@anywalletkit/wallet-solana` | 0.6.0 | 2026-11-02 |
| `@anywalletkit/swap2-assets` | 0.2.2 (the token catalog; 69 tokens on 25 source chains are used here) | 2026-10-27 |

**Provenance of this repository.** The first commit, `8e0ab20` (2026-11-07 22:36 UTC; the app was then named Stake
Anywhere, renamed to NearAnyStake in `d75bb5a` on 2026-11-08), is one large commit: the app was built in one sitting
starting from NearJar's wallet and pay code (same author): `src/lib/pay/*` (source-chain
payers), `src/lib/appkit.ts`, `src/lib/near/selector.ts` (wallet-selector setup), `src/components/PayWithSheet.tsx`
(the "Pay with" sheet), `src/components/FundsRoute.tsx` (the route strip), `Modal.tsx`, `ui.tsx`, and the design
tokens and tactile buttons in `src/app/globals.css`. Everything after it is in the commit history.

**Third-party runtime libraries** (exact versions in `package.json`): Next.js 16, React 19; NEAR Wallet Selector 10
(core, modal-ui, Meteor, HERE and Intear wallets); Reown AppKit 1.8 with its wagmi and Solana adapters and
`@wagmi/core` 2 (EVM and Solana payers; wagmi 2, viem 2, `@walletconnect/universal-provider` 2 and TanStack Query 5
are installed for AppKit and its wagmi adapter, not imported by this repo);
`@solana/kit` 8 and `@solana/web3.js` 1 (Solana deposits); `@ton/core` 0.63 and `@tonconnect/ui` 5 (TON deposits);
`sats-connect` 4 (Bitcoin wallets); `qrcode` 1 (deposit QR); `buffer` 6 (browser polyfill); `near-api-js` 6 (not
imported by this repo: it is the peer dependency of Meteor Wallet's SDK, `@meteorwallet/sdk`, which the wallet
selector's Meteor module uses). **Dev tools:** TypeScript 5, ESLint 9 with `eslint-config-next`,
Tailwind CSS 4, Vitest 4. **Fonts:** Geist, Geist Mono and Comfortaa via `next/font/google` (downloaded at build time,
served by the app).

**External services:** 1Click API (`1click.chaindefuser.com`); FastNEAR RPC (`free.rpc.fastnear.com`,
`rpc.mainnet.fastnear.com`, archival `archival-rpc.mainnet.fastnear.com`) and FastNEAR's account API (which pools an
account staked with); dRPC (`near.drpc.org`); nearblocks API (unstake history, for exact unlock epochs) and
nearblocks.io explorer links; Solana public RPC (`api.mainnet-beta.solana.com`) and toncenter (`toncenter.com`) behind
the app's proxy; Reown / WalletConnect (optional, with `NEXT_PUBLIC_REOWN_PROJECT_ID`) and TON Connect for source-chain
wallets; token icons from the catalog's CDNs (CoinGecko, CoinMarketCap, DeBank, GitHub raw). Source-chain
transactions link to etherscan.io, basescan.org, arbiscan.io, optimistic.etherscan.io, bscscan.com, polygonscan.com,
snowtrace.io, gnosisscan.io, solscan.io, tronscan.org, tonviewer.com, mempool.space and blockchair.com (Zcash,
Dogecoin) (`src/lib/near/config.ts`), and wallet-selector is configured with `helper.mainnet.near.org` and the
`api.kitwallet.app` indexer (`src/lib/near/selector.ts`).

**Other hackathon project by the same author: [NearJar](https://nearjar.xyz)**
([github.com/ultratestbro/nearjar](https://github.com/ultratestbro/nearjar)), donation jars for near.com accounts
payable from any chain. The two projects are independent; NearAnyStake reuses NearJar's wallet and pay code (listed
above).

**AI disclosure:** All commits were co-written with Claude Code (each carries a `Co-Authored-By: Claude` trailer); the
author directed, reviewed and tested the work.

## Run locally

Requirements: Node.js ≥ 22 (the Any Wallet Kit packages declare `engines.node >=22`) and pnpm 10 through Corepack
(`package.json` pins `pnpm@10.30.2` in `packageManager`).

```sh
corepack enable     # once: provides the pinned pnpm
pnpm install --frozen-lockfile
pnpm test           # vitest: quote echo, dry-run guard, status machine on recorded 1Click answers, stake amount, wallet adapter,
                    # and the staking path on the real modules against a fake NEAR node (what the wallet is asked to sign)
pnpm e2e            # read-only on mainnet: epoch, validators and the allow-list, APRs, the demo account's positions,
                    # dry 1Click quotes from Base USDC / Solana SOL / Tron USDT with the echo check, a deposit_and_stake
                    # built (not sent) for the delivered amount, and the dry-run simulated stake's preview on the demo account.
                    # View calls and dry quotes only; E2E_REPORT=file.json saves a report
                    # Uses free public NEAR nodes: a rate-limited read pauses and goes round them again, and a failed test
                    # reruns twice. A 429 that still gets through is transient: rerun it, or start it as
                    # NEXT_PUBLIC_NEAR_RPC_URL=<your NEAR node> pnpm e2e
pnpm typecheck && pnpm lint && pnpm build   # typecheck runs `next typegen` first, so it works on a fresh clone
```

`pnpm install` prints an "Ignored build scripts" warning (`@reown/appkit`, `bufferutil`, `keccak`, `secp256k1`, …):
expected and harmless, the app needs none of those install scripts.

No environment is needed; see `.env.example` for optional overrides (a Reown project id enables EVM / Solana wallet
connections in the Pay step).

Run the app (a server that keeps running until Ctrl-C, so start it last or in a second terminal):

```sh
pnpm dev            # http://localhost:3501; or `pnpm start` after `pnpm build` for the production build on the same port
```

## Layout

- `src/lib/staking.ts`: the only door to the staking modules. It hands out one module instance per account (shared
  caches), with the app's RPCs, nearblocks history for exact unlock epochs and the archival node for liquid APRs, and
  holds the app's copy of the modules' reserve rule (`exitReserve`).
- `e2e/`: the read-only mainnet checks behind `pnpm e2e`.
- `src/lib/oneclick/`: request builder and echo check, browser client with the dry-run guard, status machine,
  dry-run replay. Recorded 1Click answers in `src/lib/__fixtures__/oneclick/`.
- `src/lib/near/`: wallet-selector setup, the `IWalletAccount` adapter over it, the read-only demo account,
  app-level reads (recipient exists, Meta Pool registration, delivery amount).
- `src/app/api/rpc/[chain]`: JSON-RPC proxy for this app's own pages (Origin check, 600 calls a minute per client,
  one call per request, a method allow-list per chain). NEAR: view calls only, with failover between nodes and a
  bounded LRU cache (the 375 KB `validators` answer for a minute). Solana: the reads its deposit builder needs plus
  `simulateTransaction` and `sendTransaction`, which broadcasts the deposit the user's wallet signed. TON: get-method
  and balance reads. `APP_ORIGINS` adds origins (a custom domain behind a proxy that rewrites Host; see
  `.env.example`).

## License

Apache-2.0
