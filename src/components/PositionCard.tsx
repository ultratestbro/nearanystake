"use client";

// One position on the Portfolio: a validator pool or a liquid staking token. Each card says where
// the stake is (staked → unstaking → ready → back on the account) and offers only the actions that
// fit that state; the dialogs behind them are in PositionModals.

import { useState, type ReactNode } from "react";
import { dateTime, duration, formatNear, formatUnits, percent } from "@/lib/format";
import { compactNear, initials, poolName, usdText } from "@/lib/portfolio";
import {
  LIQUID_OPTIONS, UNSTAKED_DUST,
  type LiquidAccountDetails, type LiquidPoolInfo, type LiquidPreset, type LiquidStaking, type LiquidWithdrawalRequest, type NativeStaking, type NearEpoch, type NearPoolPosition, type UnlockEstimate,
} from "@/lib/staking";
import { useNow } from "@/lib/useAsync";
import { unbondingWindow } from "./EpochClock";
import { ClockIcon, ShieldCheckIcon } from "./icons";
import { InfoHint } from "./InfoHint";
import { ClaimModal, LiquidModal, UnstakeModal } from "./PositionModals";
import { StatusBadge, type StatusTone } from "./StatusBadge";

const WARN_TEXT: Record<string, { label: string; hint: string }> = {
  "pool-fee-above-max": { label: "Fee above 10%", hint: "The pool raised its fee above 10%. You can unstake any time." },
  "pool-paused": { label: "Pool paused", hint: "The pool's owner paused staking, so it may stop earning. You can unstake any time." },
  "pool-leaving-set": { label: "Leaving the set", hint: "The pool leaves the validator set next epoch and then stops earning. Consider unstaking." },
  "pool-not-in-set": { label: "Not validating", hint: "The pool isn't in the validator set, so it earns nothing now. Consider unstaking." },
};

/** 0 staked, 1 unstaking, 2 ready to withdraw (3, back on the account, is where a withdrawal ends). */
type Stage = 0 | 1 | 2;

const btn = "btn-tactile min-h-11 px-5 text-[15px] font-medium";
const btnAccent = "btn-tactile-accent min-h-11 px-5 text-[15px]";

function hoursToUnlock(epoch: NearEpoch | undefined, now: number): number | null {
  return epoch ? Math.max(1, Math.round((unbondingWindow(epoch).at - now) / 3_600_000)) : null;
}

function unlockLine(u: UnlockEstimate, now: number): { text: string; detail: string } {
  const to = u.at ?? u.earliestAt;
  const range = u.latestAt !== null && u.latestAt !== to;
  const text =
    to <= now
      ? "Unlocks at the next epoch boundary."
      : range
        ? `Unlocks in ${duration(to - now)} to ${duration(Math.max(0, u.latestAt! - now))}.`
        : `Unlocks in ${duration(to - now)}, around ${dateTime(to)}.`;
  const epoch = u.epoch !== null ? `Epoch ${u.epoch.toString()}` : `Epoch ${u.earliestEpoch.toString()}${u.latestEpoch !== null && u.latestEpoch !== u.earliestEpoch ? `–${u.latestEpoch.toString()}` : " or later"}`;
  const when = range ? `, between ${dateTime(to)} and ${dateTime(u.latestAt!)}` : "";
  const source = u.source === "history" ? "dated from your last unstake" : u.source === "contract" ? "read from the contract" : "an estimate: the pool only says “not yet”";
  return { text, detail: `${epoch}${when}; ${source}.` };
}

function Frame({
  label,
  disc,
  title,
  badge,
  id,
  amount,
  sub,
  facts,
  stage,
  steps,
  hint,
  actions,
}: {
  label: string;
  disc: ReactNode;
  title: string;
  badge?: ReactNode;
  id: string;
  amount: string;
  sub: ReactNode;
  facts: { label: string; value: ReactNode }[];
  stage: Stage;
  steps: [string, string, string, string];
  hint: ReactNode;
  actions: ReactNode;
}) {
  return (
    <article aria-label={label} className="rounded-[20px] border border-line bg-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-4">
        {disc}
        <div className="min-w-0 flex-[1_1_220px]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-semibold leading-6">{title}</h3>
            {badge}
          </div>
          <p className="mt-1 font-mono text-[13px] leading-5 text-muted [overflow-wrap:anywhere]">{id}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-[22px] font-semibold leading-7 tabular-nums">{amount}</p>
          <div className="mt-1 text-[13px] leading-5 text-muted">{sub}</div>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,120px),1fr))] gap-4">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[13px] leading-5 text-muted">{f.label}</dt>
            <dd className="mt-1 text-[15px] font-medium leading-6">{f.value}</dd>
          </div>
        ))}
      </dl>
      <ol aria-label="Where this stake is" className="mt-5 grid grid-cols-4 gap-1">
        {steps.map((s, i) => (
          <li key={s} aria-current={i === stage ? "step" : undefined} className={`text-xs leading-4 ${i === stage ? "font-medium text-text" : "text-muted"}`}>
            <span aria-hidden className={`mb-2 block h-1 rounded-full ${i < stage ? "bg-accent/60" : i === stage ? (stage === 1 ? "bg-warn" : "bg-accent") : "bg-line"}`} />
            {s}
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
        <div className="flex min-w-0 flex-[1_1_260px] items-start gap-2 text-sm text-muted">
          <ClockIcon className="mt-0.5" />
          <div className="min-w-0">{hint}</div>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
    </article>
  );
}

function Status({ tone, pulse, children }: { tone: StatusTone; pulse?: boolean; children: ReactNode }) {
  return (
    <StatusBadge variant="dot" tone={tone} pulse={pulse} className="text-[15px]">
      {children}
    </StatusBadge>
  );
}

export function NativePositionCard({ p, native, readOnly, account, epoch, price, onDone }: { p: NearPoolPosition; native: NativeStaking; readOnly: boolean; account: string; epoch: NearEpoch | undefined; price: number | null; onDone: () => void }) {
  const [modal, setModal] = useState<"unstake" | "claim" | null>(null);
  const now = useNow(30_000);
  const name = poolName(p.pool);
  const locked = p.unstaked >= UNSTAKED_DUST && !p.canWithdraw ? p.unstaked : 0n;
  const ready = p.withdrawable;
  const stage: Stage = ready > 0n ? 2 : locked > 0n ? 1 : 0;
  const earning = p.staked >= UNSTAKED_DUST;
  const main = earning ? p.staked : ready > 0n ? ready : locked;
  const info = p.poolInfo;
  const h = hoursToUnlock(epoch, now);
  const verified = !!info && p.warnings.length === 0 && info.paused === false && info.feePercent !== null && info.inNextSet;
  const warn = p.warnings[0] ? WARN_TEXT[p.warnings[0]] : undefined;

  const badge = warn ? (
    <InfoHint label={warn.label} trigger={<StatusBadge tone="attention">{warn.label}</StatusBadge>}>
      {warn.hint}
    </InfoHint>
  ) : verified ? (
    <InfoHint label="Verified pool" trigger={<StatusBadge tone="success" icon={<ShieldCheckIcon size={14} />}>Verified pool</StatusBadge>}>
      {`A standard staking-pool account, fee ${percent(info.feePercent, 0)} (10% at most), not paused, in the next epoch's validator set. Checked again before every signature.`}
    </InfoHint>
  ) : null;

  const status =
    stage === 2 ? (
      <Status tone="success">Ready to withdraw</Status>
    ) : stage === 1 ? (
      <Status tone="progress" pulse>
        Unstaking
      </Status>
    ) : p.warnings.includes("pool-not-in-set") ? (
      <Status tone="attention">Staked, not earning</Status>
    ) : (
      <Status tone={warn ? "attention" : "success"}>Staked, earning</Status>
    );

  const u = locked > 0n && p.unlock ? unlockLine(p.unlock, now) : null;
  const hint =
    stage === 2 ? (
      <p>Unlocked. Withdraw it to your account, then cash it out or stake it again.</p>
    ) : u ? (
      <p>
        {u.text}{" "}
        <InfoHint label="Unlock details">{u.detail}</InfoHint>
      </p>
    ) : stage === 1 ? (
      <p>Unlocking in the next few epochs.</p>
    ) : epoch && h !== null ? (
      <p>
        Unstake now and it unlocks in about {h} h, around {dateTime(unbondingWindow(epoch).at)}.{" "}
        <InfoHint label="How unstaking works">Unstaked NEAR unlocks 4 epoch boundaries later; one epoch later if the transaction lands after this epoch ends. It earns nothing while it waits.</InfoHint>
      </p>
    ) : (
      <p>Unstaking takes about 21–28 h.</p>
    );

  return (
    <>
      <Frame
        label={`${name} position`}
        disc={
          <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full border border-line bg-surface text-sm font-semibold">
            {initials(name)}
          </span>
        }
        title={name}
        badge={badge}
        id={p.pool}
        amount={formatNear(main)}
        sub={
          <>
            {earning && ready > 0n && <p>+ {formatNear(ready)} ready to withdraw</p>}
            {earning && locked > 0n && <p>+ {formatNear(locked)} unstaking</p>}
            {!earning && <p>{stage === 2 ? "ready to withdraw" : "unstaking"}</p>}
            {usdText(main, price) && <p>{usdText(main, price)}</p>}
          </>
        }
        facts={[
          { label: "Status", value: status },
          { label: "APR", value: info?.apr !== null && info?.apr !== undefined ? percent(info.apr) : "—" },
          { label: "Pool fee", value: info?.feePercent !== null && info?.feePercent !== undefined ? percent(info.feePercent, 0) : "—" },
          { label: "Pool size", value: info && info.stake > 0n ? compactNear(info.stake) : "—" },
        ]}
        stage={stage}
        steps={["Staked", h !== null ? `Unstaking, ~${h} h` : "Unstaking", "Ready to withdraw", "Back on your account"]}
        hint={hint}
        actions={
          <>
            {ready > 0n && (
              <button type="button" onClick={() => setModal("claim")} className={btnAccent}>
                Withdraw {formatNear(ready, 3)}
              </button>
            )}
            {/* still locked: the dialog previews the withdrawal and says when it unlocks */}
            {ready === 0n && locked > 0n && (
              <button type="button" onClick={() => setModal("claim")} className={btn}>
                Withdraw
              </button>
            )}
            {/* rounding dust left staked is not worth an unstake: it would restart the unlock timer of everything unstaking here */}
            {earning && (
              <button type="button" onClick={() => setModal("unstake")} className={btn}>
                Unstake
              </button>
            )}
          </>
        }
      />
      {modal === "unstake" && <UnstakeModal pool={p.pool} staked={p.staked} position={p} native={native} readOnly={readOnly} account={account} onClose={() => setModal(null)} onDone={onDone} />}
      {modal === "claim" && <ClaimModal native={native} readOnly={readOnly} account={account} onClose={() => setModal(null)} onDone={onDone} />}
    </>
  );
}

export interface LiquidData {
  details: LiquidAccountDetails;
  request: LiquidWithdrawalRequest | undefined;
  info: LiquidPoolInfo;
}

const LIQUID_TITLE: Record<LiquidPreset, { title: string; disc: string }> = {
  rnear: { title: "rNEAR by Rhea", disc: "r" },
  linear: { title: "LiNEAR", disc: "Li" },
};

/** What a liquid position holds, in the totals' terms. */
export function liquidHolding(d: LiquidData): { value: bigint; unstaking: bigint; ready: bigint } {
  const r = d.request;
  return { value: d.details.value, unstaking: r && !r.claimable ? r.amount : 0n, ready: r?.claimable ? r.amount : 0n };
}

export function LiquidPositionCard({ preset, ls, data, apr, readOnly, account, epoch, price, onDone }: { preset: LiquidPreset; ls: LiquidStaking; data: LiquidData; apr: number | null; readOnly: boolean; account: string; epoch: NearEpoch | undefined; price: number | null; onDone: () => void }) {
  const [modal, setModal] = useState<"unstake" | "claim" | null>(null);
  const now = useNow(30_000);
  const o = LIQUID_OPTIONS.find((x) => x.id === preset)!;
  const t = LIQUID_TITLE[preset];
  const { details: d, request: req, info } = data;
  const { unstaking, ready } = liquidHolding(data);
  const stage: Stage = ready > 0n ? 2 : unstaking > 0n ? 1 : 0;
  const h = hoursToUnlock(epoch, now);
  const holds = d.shares > 0n;

  const badge = info.paused ? (
    <InfoHint label="Paused" trigger={<StatusBadge tone="danger">Paused</StatusBadge>}>
      The contract is paused: it can&apos;t stake or unstake until its owner resumes it. The token itself can still be swapped.
    </InfoHint>
  ) : !info.codeHashKnown ? (
    <InfoHint label="Unknown code" trigger={<StatusBadge tone="danger">Unknown code</StatusBadge>}>
      The contract runs code this app has no pin for (an upgrade), so it won&apos;t stake into it.
    </InfoHint>
  ) : (
    <InfoHint label="Liquid token" trigger={<StatusBadge tone="liquid">Liquid token</StatusBadge>}>
      {`A token for staked NEAR: its price in NEAR grows with the rewards. Swap it any time, or unstake it (at least 4 epochs). ${o.note}.`}
    </InfoHint>
  );

  const u = req?.unlock ? unlockLine(req.unlock, now) : null;
  const hint = req?.awaitingLiquidity ? (
    <p className="text-warn">Unlocked, waiting for the protocol&apos;s payout (the contract refills after its epoch bot runs).</p>
  ) : stage === 2 ? (
    <p>Unlocked. Withdraw it to your account.</p>
  ) : stage === 1 ? (
    u ? (
      <p>
        {u.text} <InfoHint label="Unlock details">{u.detail}</InfoHint>
      </p>
    ) : (
      <p>Unlocks at epoch {d.unlockEpoch.toString()}.</p>
    )
  ) : (
    <p>Unstaking takes at least 4 epochs (about 21–35 h). Swapping the token is instant.</p>
  );

  return (
    <>
      <Frame
        label={`${o.symbol} position`}
        disc={
          <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-liquid text-sm font-bold text-accent-ink">
            {t.disc}
          </span>
        }
        title={t.title}
        badge={badge}
        id={o.contract}
        amount={holds ? `${formatUnits(d.shares, 24, 4)} ${o.symbol}` : formatNear(ready > 0n ? ready : unstaking)}
        sub={
          <>
            {holds && <p>≈ {formatNear(d.value)}</p>}
            {holds && unstaking > 0n && <p>+ {formatNear(unstaking)} unstaking</p>}
            {holds && ready > 0n && <p>+ {formatNear(ready)} ready to withdraw</p>}
            {!holds && <p>{stage === 2 ? "ready to withdraw" : "unstaking"}</p>}
            {usdText(holds ? d.value : ready + unstaking, price) && <p>{usdText(holds ? d.value : ready + unstaking, price)}</p>}
          </>
        }
        facts={[
          {
            label: "Status",
            value: stage === 2 ? <Status tone="success">Ready to withdraw</Status> : stage === 1 ? <Status tone="progress" pulse>Unstaking</Status> : <Status tone="liquid">Held, earning</Status>,
          },
          { label: "APR", value: apr !== null ? <span title="7-day price growth, annualized">{percent(apr)}</span> : "—" },
          { label: "Price", value: <span className="tabular-nums">{formatUnits(info.price, 24, 4)} NEAR</span> },
          { label: "Protocol fee", value: percent(info.feeBps / 100, 0) },
        ]}
        stage={stage}
        steps={["Held", h !== null ? `Unstaking, ~${h} h+` : "Unstaking", "Ready to withdraw", "Back on your account"]}
        hint={hint}
        actions={
          <>
            {req && (
              <button type="button" onClick={() => setModal("claim")} className={req.claimable ? btnAccent : btn}>
                Withdraw
              </button>
            )}
            {holds && (
              <button type="button" onClick={() => setModal("unstake")} className={btn}>
                Unstake
              </button>
            )}
          </>
        }
      />
      {modal && <LiquidModal kind={modal} ls={ls} symbol={o.symbol} shares={d.shares} readOnly={readOnly} account={account} onClose={() => setModal(null)} onDone={onDone} />}
    </>
  );
}
