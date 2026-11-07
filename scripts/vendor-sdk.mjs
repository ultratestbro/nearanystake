#!/usr/bin/env node
// Repacks the two Any Wallet Kit staking modules into vendor/ until they are on npm.
//
//   node scripts/vendor-sdk.mjs [path to the anywalletkit checkout on feat/near-staking]
//
// Builds both packages there, packs them (workspace ranges become the exact published versions of
// wallet-near and core), names each tarball after the source commit, and points package.json and
// pnpm-lock.yaml at the new files by editing only those entries. A plain `pnpm install` would
// re-resolve unrelated peer dependencies; this keeps the rest of the lockfile byte for byte.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const app = resolve(import.meta.dirname, "..");
const sdk = resolve(process.argv[2] ?? join(app, "..", "anywalletkit-near-staking"));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

if (run("git", ["status", "--porcelain", "--", "packages/protocol-staking-native-near", "packages/protocol-staking-liquid-near"], sdk)) {
  throw new Error(`${sdk}: the module folders have uncommitted changes; commit first so the tarball names a real commit.`);
}
const commit = run("git", ["rev-parse", "--short=8", "HEAD"], sdk);
const out = mkdtempSync(join(tmpdir(), "awk-pack-"));
let pkg = readFileSync(join(app, "package.json"), "utf8");
let lock = readFileSync(join(app, "pnpm-lock.yaml"), "utf8");

for (const kind of ["native", "liquid"]) {
  const name = `@anywalletkit/protocol-staking-${kind}-near`;
  const dir = join(sdk, "packages", `protocol-staking-${kind}-near`);
  run("pnpm", ["build"], dir);
  run("pnpm", ["pack", "--pack-destination", out], dir);
  const packed = readdirSync(out).find((f) => f.includes(`-${kind}-near-`));
  const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  const file = `vendor/anywalletkit-protocol-staking-${kind}-near-${version}-${commit}.tgz`;
  const spec = new RegExp(`(?<="${name.replace("/", "\\/")}": "file:)vendor/[^"]+(?=")`);
  const old = spec.exec(pkg)?.[0];
  if (!old) throw new Error(`package.json has no file: dependency on ${name}`);
  renameSync(join(out, packed), join(app, file));
  if (old !== file) rmSync(join(app, old), { force: true });
  const integrity = `sha512-${createHash("sha512").update(readFileSync(join(app, file))).digest("base64")}`;
  pkg = pkg.replace(spec, file);
  lock = lock
    .replace(new RegExp(`(resolution: \\{integrity: )sha512-[A-Za-z0-9+/=]+(, tarball: file:${old.replace(/[.]/g, "\\.")}\\})`), `$1${integrity}$2`)
    .replaceAll(old, file);
  console.log(`${name} ${version} (${commit}) → ${file}`);
}
rmSync(out, { recursive: true, force: true });
writeFileSync(join(app, "package.json"), pkg);
writeFileSync(join(app, "pnpm-lock.yaml"), lock);
execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: app, stdio: "inherit" });
console.log("Update the table in vendor/README.md (sha256sum vendor/*.tgz).");
