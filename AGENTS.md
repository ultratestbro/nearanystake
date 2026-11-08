<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## NearAnyStake

Next 16 App Router, React 19, Tailwind 4, pnpm. `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; dev on port 3501.

- Staking goes only through `src/lib/staking.ts`, which hands out the Any Wallet Kit module instances
  (`@anywalletkit/protocol-staking-native-near` / `-liquid-near` 0.1.0 from npm). Every read, quote and write is the
  module's; there is no fallback backend.
- `pnpm e2e` runs the read-only mainnet checks in `e2e/` (view calls and dry 1Click quotes; never signs).
- 1Click requests are built in `src/lib/oneclick/quote.ts` and sent from the browser by `client.ts`, which checks
  the echo. Never set `customRecipientMsg`, never deliver into a liquid staking token, never add a recipient field:
  the NEAR side is always the connected account.
- Stake only what was delivered (`src/lib/stakeAmount.ts`). Dry-run mode never shows a deposit address and cannot
  send `dry: false` (`src/lib/dryrun.ts`, `client.ts`).
- Amounts are bigint; never `Number()` a bigint that can exceed 2^53 (use core's `bigintToNumber`).
- English everywhere; sparse comments that say why.
