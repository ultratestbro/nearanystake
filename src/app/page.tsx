import Link from "next/link";
import { EpochClock } from "@/components/EpochClock";
import { LandingStats } from "@/components/LandingStats";
import { ValidatorList } from "@/components/ValidatorList";
import { Panel } from "@/components/ui";
import { SOURCE_ASSETS } from "@/lib/assets";

const STEPS = [
  { n: "1", t: "Pick a validator", d: "Any standard NEAR pool with a fee of 10 % or less, checked live: code, pause, fee, validator set." },
  { n: "2", t: "Pay from any chain", d: "USDC on Base, SOL, ETH, BTC, USDT on Tron… 1Click quotes it into native NEAR for your account." },
  { n: "3", t: "Watch it arrive", d: "Source chain → NEAR Intents → your NEAR account. Every step, with explorer links." },
  { n: "4", t: "Sign once to stake", d: "deposit_and_stake for exactly what was delivered. Gas comes out of the delivery." },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-5 pt-2 sm:pt-6">
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Stake NEAR <span className="text-accent">from any chain.</span>
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          Send what you already hold from any of {new Set(SOURCE_ASSETS.map((a) => a.chain)).size} chains. NEAR Intents delivers native NEAR to your own NEAR account, and one signature stakes it with the
          validator you pick, or mints rNEAR / LiNEAR. No bridge UI, no exchange, no NEAR needed up front.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/stake" className="btn-tactile-accent btn-tactile-lg px-6 py-3.5 text-base">
            Start staking
          </Link>
          <Link href="/portfolio?view=demo" className="btn-tactile btn-tactile-lg px-6 py-3.5 text-base font-medium">
            See a demo account
          </Link>
        </div>
        <p className="text-sm text-muted">
          Dry-run mode is on until you connect a NEAR wallet: real quotes, real pools, nothing to pay.
        </p>
      </section>

      <LandingStats />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <div key={s.n} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
            <span className="grid size-7 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-ink">{s.n}</span>
            <p className="font-medium">{s.t}</p>
            <p className="text-sm text-muted">{s.d}</p>
          </div>
        ))}
      </section>

      <Panel className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Validators</h2>
            <p className="text-sm text-muted">Live from the validator set. Pick one to stake into.</p>
          </div>
        </div>
        <EpochClock />
        <ValidatorList />
      </Panel>
    </div>
  );
}
