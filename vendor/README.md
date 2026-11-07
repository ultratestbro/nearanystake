# vendor/

Pre-release builds of the two Any Wallet Kit staking modules this app is built on. They are packed
from branch `feat/near-staking` of `ultratestbro/anywalletkit` and are not on npm yet, so the app
installs these tarballs and builds without a checkout of the SDK.

| Package | Version | Source commit | sha256 |
|---|---|---|---|
| `@anywalletkit/protocol-staking-native-near` | 0.0.0 | `8934c6a1` (module), packed at `4c3bc64f` | `25364bfb97c8d567afb0d1804bfcfe36bed14a45d2f1be6deaff8447638ca853` |
| `@anywalletkit/protocol-staking-liquid-near` | 0.0.0 | `4c3bc64f` | `d80d5fff11b1f8581a69e3153f64020c893ae426948eee319b432fb985337cf3` |

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
