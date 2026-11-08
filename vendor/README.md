# vendor/

Pre-release builds of the two Any Wallet Kit staking modules this app is built on. They are packed
from branch `feat/near-staking` of `ultratestbro/anywalletkit` and are not on npm yet, so the app
installs these tarballs and builds without a checkout of the SDK.

| Package | Version | Source commit | sha256 |
|---|---|---|---|
| `@anywalletkit/protocol-staking-native-near` | 0.0.0 | `a623937a` (audit fixes) | `ace922a093c6f6c34b2aee83821f11b7ee701436f99c87e24b212f33cae1a1ad` |
| `@anywalletkit/protocol-staking-liquid-near` | 0.0.0 | `a623937a` (audit fixes) | `b2fa771b965f68ca2213bef4b0d7aedf1852d027cd34d51584802f283eb4d102` |

- The version is still `0.0.0`: the SDK's release flow (changesets) gives both packages `0.1.0` when
  they are published. The file name carries the commit the tarball was packed from.
- Their dependencies are exact and come from npm: `@anywalletkit/wallet-near` 0.4.0,
  `@anywalletkit/core` 0.8.0 (peer, also a direct dependency of the app), `@noble/hashes` ^2.4.0.
- `package.json` points at the files (`file:vendor/…tgz`) and `pnpm-lock.yaml` pins their sha512, so
  `pnpm install --frozen-lockfile` refuses a tarball that was swapped.

## Repack after a module change

```sh
node scripts/vendor-sdk.mjs /path/to/anywalletkit   # a checkout of feat/near-staking with the change committed
```

It builds both packages there, packs them, replaces the tarballs here, rewrites only their entries in
`package.json` and `pnpm-lock.yaml`, and runs `pnpm install --frozen-lockfile`. Then update the table
above (`shasum -a 256 vendor/*.tgz`). Once the packages are on npm, replace both `file:` entries with
the exact published version and delete this folder.
