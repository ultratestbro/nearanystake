"use client";

import { bigintToNumber } from "@anywalletkit/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { KNOWN_MINIMUM_USD, PINNED_CHAINS, SOURCE_ASSETS, findAsset, looksLikeAddress, type SourceAsset } from "@/lib/assets";
import { NEAR_N_PATH } from "@/lib/brand";
import { addRecord, getFlow, newId, updateFlow, type FlowRecord } from "@/lib/history";
import { DEMO_ACCOUNT, SUGGESTED_POOL } from "@/lib/near/config";
import { checkRecipient, deliveredOnChain, instantStNearEligible, nearClient, nearSpendable } from "@/lib/near/reads";
import { getStatus, listTokens, requestQuote, submitDepositTx } from "@/lib/oneclick/client";
import { NEAR_ASSET, STNEAR_ASSET, addressInactiveAt, buildInboundQuoteRequest, deadlineMsFor, payCutoffMs, quoteDeadline } from "@/lib/oneclick/quote";
import { SIM_OUTCOMES, simulatedStatuses, type SimOutcome } from "@/lib/oneclick/simulate";
import { deliveryTxHash, depositTxHashes, fundsView, isFinal, isTerminal, phaseOf, reportedDelivery, type Phase } from "@/lib/oneclick/status";
import type { QuoteRequest, QuoteResponse, StatusResponse } from "@/lib/oneclick/types";
import { connectPayer, type Payer } from "@/lib/pay";
import { ago, clock, dateTime, duration, formatNear, formatUnits, money, parseUnits, percent, shortAccount } from "@/lib/format";
import { stakeAmountAfterDelivery, type StakeAmount } from "@/lib/stakeAmount";
import { FRESH_ACCOUNT_STORAGE, keptFromDelivery, nearForUsd, sharesFor, stakedFromDelivery, yearlyReward } from "@/lib/stakeEstimate";
import {
  LIQUID_OPTIONS, MIN_STAKE, NUM_EPOCHS_TO_UNLOCK, liquidStaking, nativeStaking, refusalText, stakeOverhead, stakingErrorText,
  type LiquidPoolInfo, type LiquidPreset, type LiquidStakeQuote, type NearEpoch, type NearPoolInfo, type NearStakeQuote,
} from "@/lib/staking";
import { DRY_REFUND } from "@/lib/dryrun";
import { useAsync, useNow, type AsyncState } from "@/lib/useAsync";
import { useApp } from "./AppProvider";
import { DepositPanel } from "./DepositPanel";
import { Disclosure } from "./Disclosure";
import { unbondingWindow, useEpoch } from "./EpochClock";
import { ExplorerLink, IntentsGlyph, RouteStrip, StepList, type RouteNode, type StepState, type TrackStep } from "./FundsRoute";
import { ShieldCheckIcon } from "./icons";
import { InfoHint } from "./InfoHint";
import { Modal } from "./Modal";
import { PayWithButton, PayWithSheet, TokenIcon } from "./PayWithSheet";
import { PoolAvatar, compactNear, poolBadge, poolName } from "./PoolAvatar";
import { Box, CHIP, CTA, CardShell, DetailRow, FormCard, HowItWorks, ModeLine, Notice, QUIET, SECONDARY, StakeIntro, TargetChoice, TargetRow, nearAmount } from "./StakeCard";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import { TxPreview } from "./TxPreview";
import { ValidatorList } from "./ValidatorList";
import { Skeleton, Spinner } from "./ui";

export type Target = { kind: "native"; pool: string } | { kind: "liquid"; preset: LiquidPreset } | { kind: "stnear" };

const targetLabel = (t: Target) => (t.kind === "native" ? t.pool : t.kind === "liquid" ? LIQUID_OPTIONS.find((o) => o.id === t.preset)!.symbol : "stNEAR");
const targetKey = (t: Target) => (t.kind === "native" ? `native:${t.pool}` : t.kind === "liquid" ? `liquid:${t.preset}` : "stnear");
/** The name people read: "astro-stakers", "rNEAR", "stNEAR". */
const targetShort = (t: Target) => (t.kind === "native" ? poolName(t.pool) : targetLabel(t));

function parseTarget(key: string | undefined): Target | null {
  if (!key) return null;
  if (key === "stnear") return { kind: "stnear" };
  if (key.startsWith("native:")) return { kind: "native", pool: key.slice(7) };
  if (key.startsWith("liquid:")) return { kind: "liquid", preset: key.slice(7) as LiquidPreset };
  return null;
}

type Stage = "setup" | "review" | "track";

// ── Data the card shows about the target (pool / token), shared by the form and the tracker ─────────

type LiquidData = { info: LiquidPoolInfo; apr: number | null };
interface TargetData {
  pool: AsyncState<NearPoolInfo | null>;
  liquid: Record<LiquidPreset, AsyncState<LiquidData>>;
  instant: AsyncState<{ ok: boolean; reason: string } | null>;
}

function useLiquidData(preset: LiquidPreset, demo: ReturnType<typeof useApp>["demo"]): AsyncState<LiquidData> {
  const ls = useMemo(() => liquidStaking(demo, preset), [demo, preset]);
  return useAsync(() => Promise.all([ls.getPoolInfo(), ls.getApr().catch(() => null)]).then(([info, apr]) => ({ info, apr })), [ls]);
}

/**
 * NEAR of a delivery that stays on the account (the gas reserve and the stake's prepaid gas), for
 * the preview only. A dry run replays a delivery to a brand-new account, as its simulated stake does.
 * Once the delivery is on the account (`delivered`), it is taken out of what the account could
 * already spend, so the preview still describes this delivery.
 */
function useKept(target: Target, recipient: string | null, simulated: boolean, demo: ReturnType<typeof useApp>["demo"], delivered: bigint | null = null): AsyncState<bigint> {
  const kind = target.kind === "native" ? "native" : target.kind === "liquid" ? target.preset : null;
  return useAsync(async () => {
    if (!kind) return 0n;
    const mod = kind === "native" ? nativeStaking(demo) : liquidStaking(demo, kind);
    const overhead = await stakeOverhead(mod, nearClient().rpc);
    if (simulated || !recipient) return keptFromDelivery({ overhead, spendable: 0n, fresh: true });
    const [spendable, r] = await Promise.all([nearSpendable(recipient), checkRecipient(recipient)]);
    if (delivered === null) return keptFromDelivery({ overhead, spendable, fresh: r.ok && !r.exists });
    // what the account could spend before the delivery; below zero when the delivery paid a new account's storage
    const kept = overhead - (spendable - delivered);
    return kept > 0n ? kept : 0n;
  }, [kind, recipient, simulated, demo, delivered]);
}

interface TargetView {
  name: string;
  short: string;
  avatar: ReactNode;
  apr: number | null;
  meta: ReactNode;
  badge: ReactNode;
  problem: { text: string; tone: "danger" | "warn" } | null;
  fee: { label: string; text: string } | null;
  /** Liquid token price, yocto per whole token. */
  price: bigint | null;
}

function trustBadge(label: string, tone: StatusTone, details: string) {
  // phones: a good mark is just the shield (the word stays for screen readers); a problem keeps its word
  const ok = tone === "success";
  return (
    <InfoHint
      label={label}
      // the pill is 24 px tall: the hit area reaches 44 px
      className="relative after:absolute after:-inset-2.5 after:rounded-full after:content-['']"
      trigger={
        <StatusBadge tone={tone} icon={ok ? <ShieldCheckIcon size={14} /> : undefined} className={ok ? "max-sm:px-1.5" : ""}>
          <span className={ok ? "max-sm:sr-only" : ""}>{label}</span>
        </StatusBadge>
      }
    >
      {details}
    </InfoHint>
  );
}

function targetView(t: Target, d: TargetData, recipient: string | null): TargetView {
  if (t.kind === "native") {
    const p = d.pool.data && d.pool.data.id === t.pool ? d.pool.data : null;
    const name = poolName(t.pool);
    const b = p ? poolBadge(p) : null;
    const fee = p && p.feePercent !== null ? percent(p.feePercent, p.feePercent % 1 ? 1 : 0) : null;
    return {
      name,
      short: name,
      avatar: <PoolAvatar name={name} size={36} />,
      apr: p?.apr ?? null,
      meta: p ? (
        <>
          <span className="whitespace-nowrap">{percent(p.apr)} APR</span> · <span className="whitespace-nowrap">{fee ? `${fee} fee` : "fee —"}</span> ·{" "}
          <span className="whitespace-nowrap">
            {compactNear(p.stake)}&nbsp;NEAR<span className="max-sm:hidden"> in pool</span>
          </span>
        </>
      ) : (
        d.pool.error || <Skeleton className="mt-1 h-4 w-44" />
      ),
      badge: b ? trustBadge(b.label, b.tone, b.details) : null,
      problem: p && !p.eligible ? { text: `Can't take stake: ${p.refusals.map(refusalText).join(", ")}.`, tone: "danger" } : null,
      fee: fee ? { label: "Pool fee", text: `${fee} of rewards, already in the APR` } : null,
      price: null,
    };
  }
  if (t.kind === "liquid") {
    const o = LIQUID_OPTIONS.find((x) => x.id === t.preset)!;
    const s = d.liquid[t.preset];
    const l = s.data;
    const ok = !!l && !l.info.paused && l.info.codeHashKnown;
    const badge = !l
      ? null
      : ok
        ? trustBadge("Verified", "success", `Checked live: ${o.contract} runs known code (pinned by account and code hash) and is not paused. One signature after delivery mints the token; nothing is ever sent to it by transfer.`)
        : l.info.paused
          ? trustBadge("Paused", "danger", `${o.contract} is paused right now, so a delivery couldn't be staked.`)
          : trustBadge("Unknown code", "danger", `${o.contract} runs code this app doesn't know yet (an upgrade), so it won't stake into it.`);
    return {
      name: o.label,
      short: o.symbol,
      avatar: <PoolAvatar name={o.symbol} tone="liquid" size={36} />,
      apr: l?.apr ?? null,
      meta: l ? (
        <>
          <span className="whitespace-nowrap">{percent(l.apr)} APR</span> · <span className="whitespace-nowrap">1 {o.symbol} = {formatUnits(l.info.price, 24, 4)} NEAR</span>
        </>
      ) : s.error ? (
        "unavailable right now"
      ) : (
        <Skeleton className="mt-1 h-4 w-44" />
      ),
      badge,
      problem: l && !ok ? { text: `${o.label} can't take stake right now. Pick a validator pool instead.`, tone: "danger" } : null,
      fee: l ? { label: "Protocol fee", text: `${(l.info.feeBps / 100).toFixed(l.info.feeBps % 100 ? 1 : 0)}% of rewards, already in the APR` } : null,
      price: l?.info.price ?? null,
    };
  }
  const el = d.instant.data;
  return {
    name: "Meta Pool stNEAR",
    short: "stNEAR",
    avatar: <PoolAvatar name="stNEAR" tone="instant" size={36} />,
    apr: null,
    meta: "Delivered straight by 1Click · no NEAR signature",
    badge: d.instant.loading ? <Spinner /> : el?.ok ? trustBadge("Ready", "success", `${recipient ?? "Your account"} can receive stNEAR.`) : trustBadge("Not available", "attention", el?.reason ?? d.instant.error),
    // the reason may already point elsewhere ("Use the main flow instead."): say it once, concretely
    problem: !d.instant.loading && !el?.ok ? { text: `${(el?.reason ?? d.instant.error).replace(/\s*Use the main flow instead\.$/, "")} Pick a validator pool or rNEAR instead.`, tone: "warn" } : null,
    fee: null,
    price: null,
  };
}

/** USD value of NEAR (or stNEAR) at a price, for display. */
const usdOf = (yocto: bigint, price: number | null | undefined) => (price ? (bigintToNumber(yocto / 10n ** 16n) / 1e8) * price : null);

/** "unlocks ~26 h after unstaking", with the epoch arithmetic in a hint. */
function unlockFacts(t: Target, e: NearEpoch | null, now: number): { value: string; hint: string } {
  if (t.kind === "stnear") return { value: "instant unstake at Meta Pool's discount", hint: "Instant unstake later uses Meta Pool's own live discount." };
  const epochH = e ? (e.epochMs / 3_600_000).toFixed(1) : "7";
  if (!e) return { value: t.kind === "native" ? "unlocks about a day after unstaking" : "unlocks 1–1.5 days after unstaking", hint: `An epoch lasts about ${epochH} h. Unstaking takes 4 epoch boundaries (liquid tokens 4–5 or more).` };
  const w = unbondingWindow(e);
  const h = (ms: number) => Math.max(1, Math.round((ms - now) / 3_600_000));
  if (t.kind === "native")
    return {
      value: `unlocks ~${h(w.at)} h after unstaking`,
      hint: `An epoch lasts about ${epochH} h. Unstake now and it unlocks at epoch ${(e.height + NUM_EPOCHS_TO_UNLOCK).toString()}, around ${dateTime(w.at)}; one epoch later if the transaction lands after this epoch ends.`,
    };
  return {
    value: `unlocks ${h(w.at)}+ h after unstaking`,
    hint: `Usually ${h(w.at)}–${h(w.ifLate)} h: rNEAR and LiNEAR unstake in 4–5 or more epochs (an epoch lasts about ${epochH} h); the exact epoch shows after you unstake.`,
  };
}

const KEPT_HINT =
  "A small gas reserve stays on your account so you can unstake later: NEAR holds back a transaction's prepaid gas when it accepts it and refunds the unused part seconds later. You can withdraw what stays any time.";

function keptText(kept: bigint | undefined) {
  if (kept === undefined) return <Skeleton className="ml-auto h-4 w-40" />;
  if (kept === 0n) return "Nothing extra: your account already holds the gas reserve";
  return `≈ ${nearAmount(kept)} NEAR for gas, so you can unstake later`;
}

/** The "You get" panel: what ends up staked and its value, then what it earns and how fast it unlocks in one line. */
function YouGet({ where, big, usd, earns, unlock, hint }: { where: string; big: ReactNode; usd: number | null; earns: ReactNode; unlock: { value: string; hint: string }; hint: string }) {
  return (
    <Box>
      <div className="flex items-center justify-between gap-4 text-[13px] leading-5 text-muted">
        <span className="inline-flex items-center gap-0.5">
          You get <InfoHint label="How this is worked out">{hint}</InfoHint>
        </span>
        <span className="truncate">{where}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
        {/* a little smaller on phones so "≈ 0.9359 stNEAR" and its $ stay on one line */}
        <span className="text-[26px] font-semibold leading-9 tracking-[-0.02em] tabular-nums sm:text-[30px] sm:leading-10">{big}</span>
        {usd !== null && <span className="text-sm text-muted">≈ {money(usd)}</span>}
      </div>
      {/* two pieces that each move to the next line whole, so a wrap falls at the "·" */}
      <p className="mt-1 text-[13px] leading-5 text-muted">
        {earns && (
          <>
            <span className="inline-block">{earns}&nbsp;·</span>{" "}
          </>
        )}
        <span className="inline-block">
          {earns ? unlock.value : cap(unlock.value)}
          <span className="whitespace-nowrap">
            &#8288;
            <InfoHint label="When unstaked NEAR unlocks" className="-my-0.5">
              {unlock.hint}
            </InfoHint>
          </span>
        </span>
      </p>
    </Box>
  );
}

/** "≈ 0.0633 NEAR a year" (read out as "Earns …"), or null while the numbers aren't known. */
function earnsText(t: Target, staked: bigint | null, apr: number | null): ReactNode {
  if (t.kind === "stnear") return "Grows with Meta Pool's rewards";
  if (staked === null || apr === null) return null;
  return (
    <>
      <span className="sr-only">Earns </span>≈ {nearAmount(yearlyReward(staked, apr))} NEAR a year
    </>
  );
}

// ── The form ────────────────────────────────────────────────────────────────────────────────────────

export function StakeFlow() {
  const params = useSearchParams();
  const { near, dryRun, demo, restoring, connecting: nearConnecting, connectNear } = useApp();
  // a flow reopened from Recent activity (?flow=…) resumes at its status; this component renders on the client only
  const [resumed] = useState(() => {
    const id = params.get("flow");
    const r = id ? getFlow(id) : null;
    const t = r ? parseTarget(r.target) : null;
    return r && t ? { r, t } : null;
  });
  const [target, setTarget] = useState<Target>(() => resumed?.t ?? { kind: "native", pool: params.get("pool") || SUGGESTED_POOL });
  // the validator pool comes back when the user switches to a liquid token and back
  const [pickedPool, setPickedPool] = useState(() => (target.kind === "native" ? target.pool : SUGGESTED_POOL));
  const [asset, setAsset] = useState<SourceAsset | null>(() => (resumed ? findAsset(resumed.r.source.chain, resumed.r.source.symbol) : findAsset("eip155:8453", "USDC")) ?? null);
  const [amountText, setAmountText] = useState("5");
  const [refundTo, setRefundTo] = useState("");
  const [ownWallet, setOwnWallet] = useState(false);
  const [payer, setPayer] = useState<Payer | null>(null);
  const [connectingPayer, setConnectingPayer] = useState(false);
  const [sheet, setSheet] = useState<"source" | "pool" | null>(null);
  const [stage, setStage] = useState<Stage>(resumed ? "track" : "setup");
  const [quote, setQuote] = useState<{ req: QuoteRequest; res: QuoteResponse; flowId: string } | null>(() =>
    resumed ? { req: resumed.r.quote.quoteRequest as QuoteRequest, res: resumed.r.quote, flowId: resumed.r.id } : null,
  );
  const [err, setErr] = useState("");
  const [quoting, setQuoting] = useState(false);
  // "send it by hand": no wallet on the source chain, the quote's deposit address is paid manually
  const [manual, setManual] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editRefund, setEditRefund] = useState(false);
  const now = useNow(60_000);

  const recipient = near?.accountId ?? (dryRun ? DEMO_ACCOUNT : null);
  const amount = asset ? parseUnits(amountText, asset.decimals) : null;
  const prices = useAsync(() => listTokens().then((ts) => new Map(ts.map((t) => [t.assetId, t.price]))), []);
  const price = asset ? prices.data?.get(asset.assetId) : undefined;
  const usd = amount !== null && price && asset ? Number(formatUnits(amount, asset.decimals, 8).replace(/,/g, "")) * price : null;
  const minUsd = asset ? KNOWN_MINIMUM_USD[asset.chain] : undefined;
  const nearUsd = prices.data?.get(NEAR_ASSET);
  const stNearUsd = prices.data?.get(STNEAR_ASSET);

  const staking = useMemo(() => nativeStaking(demo), [demo]);
  const pool = useAsync(() => staking.getPool(pickedPool), [staking, pickedPool]);
  const rnear = useLiquidData("rnear", demo);
  const linear = useLiquidData("linear", demo);
  const instant = useAsync(
    () => (target.kind !== "stnear" ? Promise.resolve(null) : recipient ? instantStNearEligible(recipient) : Promise.resolve({ ok: false, reason: "Connect a NEAR wallet." })),
    [recipient, target.kind],
  );
  const data: TargetData = { pool, liquid: { rnear, linear }, instant };
  const epoch = useEpoch();
  const kept = useKept(target, recipient, dryRun, demo);

  const connect = useCallback(async () => {
    if (!asset?.family) return;
    setErr("");
    setConnectingPayer(true);
    try {
      const p = await connectPayer(asset.family);
      setPayer(p);
      // refunds go back to the wallet the money comes from
      setRefundTo(p.address);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(m)) setErr(m);
    } finally {
      setConnectingPayer(false);
    }
  }, [asset]);

  const getQuote = async () => {
    setErr("");
    if (!asset || amount === null || amount <= 0n) return setErr("Enter an amount.");
    if (!recipient) return setErr("Connect your NEAR wallet: the NEAR is delivered to it.");
    const refund = refundTo.trim() || (dryRun && asset.family ? DRY_REFUND[asset.family] ?? "" : "");
    // the refund address and its confirmation live in Details: open it where the fix is
    const refundProblem = !refund
      ? `Enter your own ${asset.chainLabel} address for refunds.`
      : !looksLikeAddress(asset.chain, refund)
        ? `That doesn't look like a ${asset.chainLabel} address.`
        : !dryRun && !ownWallet && payer?.address !== refund
          ? "Confirm the refund address is your own wallet, not an exchange deposit address."
          : null;
    if (refundProblem) {
      setDetailsOpen(true);
      return setErr(refundProblem);
    }
    setQuoting(true);
    try {
      const r = await checkRecipient(recipient);
      if (!r.ok) throw new Error(r.error);
      if (target.kind === "stnear") {
        const el = await instantStNearEligible(recipient);
        if (!el.ok) throw new Error(el.reason);
      }
      if (target.kind === "native") {
        // refuse before any money moves: a pool that can't take stake now would strand the delivery on the account
        const p = await nativeStaking(demo).getPool(target.pool);
        if (!p.eligible) throw new Error(`${target.pool} can't take stake right now: ${p.refusals.map(refusalText).join(", ")}.`);
      }
      if (target.kind === "liquid") {
        // the same for the token contract: a paused one or an upgrade the module has no pin for can't mint
        const info = await liquidStaking(demo, target.preset).getPoolInfo();
        if (info.paused) throw new Error(`${info.name} is paused right now, so the delivery couldn't be staked. Pick a validator pool instead.`);
        if (!info.codeHashKnown) throw new Error(`${info.contract} runs code this app doesn't know yet (an upgrade), so it won't stake into it. Pick a validator pool instead.`);
      }
      const req = buildInboundQuoteRequest({ target: target.kind === "stnear" ? "stnear" : "near", originAsset: asset.assetId, amount, recipient, refundTo: refund, dry: dryRun, deadlineMs: deadlineMsFor(asset.chain) });
      const res = await requestQuote(req, { dryRun, direction: "inbound", depositAddressValid: (a) => looksLikeAddress(asset.chain, a) });
      const flowId = newId();
      const record: FlowRecord = {
        id: flowId,
        type: "flow",
        kind: target.kind === "stnear" ? "instant-stnear" : "stake-in",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dry: req.dry,
        account: recipient,
        target: targetKey(target),
        targetLabel: targetLabel(target),
        source: { chain: asset.chain, chainLabel: asset.chainLabel, symbol: asset.symbol, decimals: asset.decimals },
        quote: res,
        status: null,
        staked: null,
        txs: [],
      };
      addRecord(record);
      setQuote({ req, res, flowId });
      setStage("review");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setQuoting(false);
    }
  };

  if (stage !== "setup" && quote && asset)
    return (
      <QuoteAndTrack
        stage={stage}
        setStage={setStage}
        quote={quote}
        asset={asset}
        target={target}
        recipient={quote.req.recipient}
        record={resumed && resumed.r.id === quote.flowId ? resumed.r : null}
        payer={payer}
        connectingPayer={connectingPayer}
        onConnectPayer={asset.family ? () => void connect() : null}
        onRestart={() => {
          setQuote(null);
          setStage("setup");
        }}
        manual={manual}
        data={data}
        epoch={epoch.data ?? null}
      />
    );

  const tv = targetView(target, data, recipient);
  const instantTarget = target.kind === "stnear";
  const delivered = instantTarget ? null : nearForUsd(usd, nearUsd);
  const staked = delivered !== null && kept.data !== undefined ? stakedFromDelivery(delivered, kept.data) : null;
  const stNear = instantTarget ? nearForUsd(usd, stNearUsd) : null;
  const shares = target.kind === "liquid" && staked !== null && tv.price ? sharesFor(staked, tv.price) : null;
  const loadingNumbers = amount !== null && amount > 0n && (prices.loading || (!instantTarget && kept.loading));
  const big =
    instantTarget && stNear !== null ? (
      `≈ ${nearAmount(stNear)} stNEAR`
    ) : target.kind === "liquid" && shares !== null ? (
      `≈ ${nearAmount(shares)} ${tv.short}`
    ) : staked !== null && target.kind === "native" ? (
      `≈ ${nearAmount(staked)} NEAR`
    ) : loadingNumbers ? (
      <Skeleton className="h-10 w-40" />
    ) : (
      "—"
    );
  const bigUsd = instantTarget ? (stNear !== null ? usdOf(stNear, stNearUsd) : null) : staked !== null ? usdOf(staked, nearUsd) : null;

  const highest = target.kind === "native" && tv.apr !== null && [rnear.data?.apr, linear.data?.apr].every((a) => a === null || a === undefined || tv.apr! > a);
  const hintLine =
    target.kind === "native"
      ? `${highest ? "Native staking pays the most here. " : ""}Unlocks about a day after you unstake.`
      : target.kind === "liquid"
        ? `You hold ${tv.short}, a token that grows in NEAR value. Unstaking takes 4–5 or more epochs.`
        : "Costs more than staking yourself: compare it with a NEAR quote. Instant unstake uses Meta Pool's live discount.";

  // refunds: auto-filled from the paying wallet, editable in Details
  const refund = refundTo.trim();
  const dryStandIn = dryRun && asset?.family ? DRY_REFUND[asset.family] : undefined;
  const confirmOwn = !dryRun && payer?.address !== refund;
  const showRefundInput = editRefund || (!payer && !dryStandIn);
  const chain = asset?.chainLabel ?? "the source chain";
  const detailsHint = !dryRun && !refund ? (
    <span className="text-warn">Add a refund address</span>
  ) : confirmOwn && !ownWallet ? (
    <span className="text-warn">Confirm the refund address</span>
  ) : !near ? (
    "To a demo account (dry run)"
  ) : (
    `To ${recipient ? shortAccount(recipient) : "your NEAR account"}${refund ? ` · refunds to ${shortAccount(refund)}` : ""}`
  );

  // one primary action that says what comes next
  const needsPayer = !dryRun && !!near && !!asset?.family && !payer && !manual;
  const ctaKind: "wait" | "near" | "payer" | "quote" = !near ? (restoring ? "wait" : "near") : needsPayer ? "payer" : "quote";
  const ctaLabel =
    ctaKind === "wait"
      ? "Checking for your NEAR wallet…"
      : ctaKind === "near"
        ? nearConnecting
          ? "Connecting…"
          : "Connect NEAR wallet"
        : ctaKind === "payer"
          ? connectingPayer
            ? "Connecting…"
            : `Connect a ${asset!.chainLabel} wallet`
          : quoting
            ? "Getting a quote…"
            : dryRun
              ? "Get a dry-run quote"
              : payer
                ? "Get quote"
                : "Get a deposit address";
  const ctaDisabled = ctaKind === "wait" || (ctaKind === "near" && nearConnecting) || (ctaKind === "payer" && connectingPayer) || (ctaKind === "quote" && (quoting || !asset));
  let secondary: ReactNode = null;
  // the line under the action: the mode, a few words on what follows, the full sentence in a hint
  let mode: { text: string; hint: string } = { text: "Dry run until you connect", hint: "Your NEAR is delivered to your own NEAR account, so that comes first." };
  if (ctaKind === "near") {
    secondary = (
      <button type="button" onClick={() => void getQuote()} disabled={quoting || !asset} className={SECONDARY}>
        {quoting ? "Getting a dry-run quote…" : "Get a dry-run quote · nothing to pay"}
      </button>
    );
  } else if (near && dryRun) {
    mode = { text: "Dry run: nothing to pay", hint: "Dry run: real quotes, no deposit address, nothing to pay." };
  } else if (near && ctaKind === "payer") {
    secondary = (
      <button
        type="button"
        onClick={() => {
          setManual(true);
          setDetailsOpen(true);
        }}
        className={QUIET}
      >
        Or send it by hand instead
      </button>
    );
    mode = { text: `Live · then sign once in ${near.walletName}`, hint: `Next: get a quote, pay from that wallet, then sign once in ${near.walletName} to stake.` };
  } else if (near) {
    if (manual && !payer && asset?.family)
      secondary = (
        <button type="button" onClick={() => setManual(false)} className={QUIET}>
          Pay from a wallet instead
        </button>
      );
    mode = instantTarget
      ? { text: "Live · no NEAR signature", hint: "Next: pay, and stNEAR arrives with no NEAR signature." }
      : {
          text: `Live · then sign once in ${near.walletName}`,
          hint: payer
            ? `Next: pay from ${payer.label}, then sign once in ${near.walletName} to stake.`
            : `Next: send the exact amount to a one-time address, then sign once in ${near.walletName} to stake.`,
        };
  }

  const pay = (
    <Box className="has-[#pay-amount:focus-visible]:ring-2 has-[#pay-amount:focus-visible]:ring-accent/70">
      <div className="flex min-h-5 items-center justify-between gap-4 text-[13px] leading-5">
        <label htmlFor="pay-amount" className="text-muted">
          You pay
        </label>
        {payer && (
          <span className="truncate text-muted">
            from <span className="font-mono text-text">{shortAccount(payer.address)}</span>
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <input
          id="pay-amount"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          aria-describedby="pay-usd"
          className="h-12 w-full min-w-0 flex-1 bg-transparent text-[32px] font-semibold leading-[48px] tracking-[-0.02em] tabular-nums outline-none focus-visible:outline-none sm:text-[40px]"
        />
        <PayWithButton asset={asset} onClick={() => setSheet("source")} />
      </div>
      {/* 6 px down: the quick-amount chips' 44 px hit areas stay off the amount field and token button */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p id="pay-usd" className="text-sm leading-5 text-muted">
          {usd !== null ? `≈ ${money(usd)}` : amount === null && amountText.trim() ? "Enter an amount" : " "}
          {minUsd && usd !== null && usd < minUsd && <span className="block text-warn">{asset?.chainLabel} currently has a ${minUsd} minimum</span>}
        </p>
        {price && asset && (
          <div className="flex gap-1.5">
            {[5, 20, 50, 100].map((d) => (
              <button
                key={d}
                type="button"
                aria-label={`Pay about $${d}`}
                onClick={() => setAmountText(formatUnits(BigInt(Math.round((d / price) * 10 ** Math.min(asset.decimals, 8))) * 10n ** BigInt(Math.max(0, asset.decimals - 8)), asset.decimals, 6).replace(/,/g, ""))}
                className={`${CHIP} min-h-8 px-2.5 text-xs`}
              >
                ${d}
              </button>
            ))}
          </div>
        )}
      </div>
    </Box>
  );

  const into = (
    <Box>
      <div className="flex min-h-6 items-center justify-between gap-3 text-[13px] leading-5">
        <span className="inline-flex min-w-0 items-center gap-0.5 text-muted">
          <span id="into-label">You stake into</span>
          <InfoHint label="About this choice">{hintLine}</InfoHint>
        </span>
        {/* the instant route is a real choice with its own flow; it sits beside the label to stay one line */}
        <button
          type="button"
          aria-pressed={instantTarget}
          aria-describedby="instant-about"
          onClick={() => setTarget(instantTarget ? { kind: "native", pool: pickedPool } : { kind: "stnear" })}
          className="relative inline-flex shrink-0 items-center gap-2 rounded-lg text-left text-muted after:absolute after:-inset-x-1.5 after:-inset-y-3 after:content-[''] hover:text-text"
        >
          <span aria-hidden className={`grid size-4 shrink-0 place-items-center rounded-full border-2 ${instantTarget ? "border-accent" : "border-line"}`}>
            {instantTarget && <span className="size-1.5 rounded-full bg-accent" />}
          </span>
          {/* phones drop the token name to keep the cost visible on one line; screen readers still hear it */}
          <span>
            <span className="font-medium text-text">
              Instant<span className="max-sm:sr-only"> stNEAR</span>
            </span>{" "}
            · costs more
          </span>
        </button>
        <span id="instant-about" className="sr-only">
          Delivered by 1Click, no NEAR signature, costs more.
        </span>
      </div>
      <TargetChoice
        labelledBy="into-label"
        value={target.kind === "native" ? "native" : target.kind === "liquid" ? target.preset : null}
        options={[
          { id: "native" as const, label: "Validator", rate: percentOrDash(pool.data?.id === pickedPool ? pool.data.apr : null) },
          { id: "rnear" as const, label: "rNEAR", rate: percentOrDash(rnear.data?.apr) },
          { id: "linear" as const, label: "LiNEAR", rate: percentOrDash(linear.data?.apr) },
        ]}
        onChange={(k) => setTarget(k === "native" ? { kind: "native", pool: pickedPool } : { kind: "liquid", preset: k })}
      />
      <TargetRow
        avatar={tv.avatar}
        title={tv.name}
        meta={tv.meta}
        badge={tv.badge}
        onClick={target.kind === "native" ? () => setSheet("pool") : undefined}
        clickLabel={target.kind === "native" ? `Change pool. Selected: ${tv.name}` : undefined}
      />
      {tv.problem && <p className={`mt-2 text-[13px] leading-5 ${tv.problem.tone === "danger" ? "text-danger" : "text-warn"}`}>{tv.problem.text}</p>}
    </Box>
  );

  const summary = (
    <YouGet
      where={target.kind === "native" ? `Staked in ${tv.short}` : `${tv.short} on your account`}
      big={big}
      usd={bigUsd}
      earns={earnsText(target, staked, tv.apr)}
      unlock={unlockFacts(target, epoch.data ?? null, now)}
      hint={
        instantTarget
          ? "An estimate at today's prices. The quote shows exactly how much stNEAR arrives."
          : "An estimate at today's prices. The quote is exact; what is staked is exactly what arrives, minus the gas reserve kept on your account."
      }
    />
  );

  const details = (
    <Disclosure summary="Details" hint={detailsHint} open={detailsOpen} onOpenChange={setDetailsOpen}>
      <dl className="text-[13px] leading-5">
        <DetailRow label={instantTarget ? "stNEAR goes to" : "NEAR goes to"}>
          {recipient ? <span className="font-mono">{shortAccount(recipient)}</span> : "your NEAR account"}
          {delivered !== null && ` · ≈ ${nearAmount(delivered)} NEAR`}
          {!near && recipient && <span className="block text-warn">the demo account, dry run</span>}
        </DetailRow>
        {!instantTarget && (
          <DetailRow label="Kept on your account" hint={<InfoHint label="Why some NEAR stays on your account">{KEPT_HINT}</InfoHint>}>
            {keptText(kept.data)}
          </DetailRow>
        )}
        <DetailRow label="If anything fails">
          {refund ? (
            <>
              Refund to <span className="font-mono">{shortAccount(refund)}</span> on {chain}
            </>
          ) : dryStandIn ? (
            "Nothing to refund in a dry run"
          ) : dryRun ? (
            <span className="text-warn">Needed even in a dry run for {chain}</span>
          ) : (
            <span className="text-warn">Add your own {chain} address</span>
          )}
          {(payer || dryStandIn) && (
            <button
              type="button"
              onClick={() => setEditRefund(!editRefund)}
              aria-expanded={showRefundInput}
              // a 20 px line of text: the hit area reaches 44 px
              className="relative ml-2 whitespace-nowrap font-medium text-accent after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:underline"
            >
              {editRefund ? "Done" : refund ? "Change" : "Add one"}
            </button>
          )}
        </DetailRow>
        {tv.fee && <DetailRow label={tv.fee.label}>{tv.fee.text}</DetailRow>}
      </dl>
      {showRefundInput && (
        <label className="mt-2 flex flex-col gap-1.5">
          <span className="text-[13px] text-muted">Refund address on {chain}</span>
          <input
            value={refundTo}
            onChange={(e) => {
              setRefundTo(e.target.value);
              // a ticked "my own wallet" vouched for the old text, not this one
              setOwnWallet(false);
            }}
            placeholder={dryRun ? (dryStandIn ? "optional in a dry run (a burn address stands in)" : "needed even in a dry run for this chain") : "your own wallet address"}
            spellCheck={false}
            autoComplete="off"
            className="min-h-11 rounded-xl border border-line bg-surface px-3 font-mono text-sm outline-none focus:border-accent"
          />
        </label>
      )}
      {confirmOwn && (
        <label className="mt-3 flex min-h-11 items-start gap-2.5 text-[13px] leading-5">
          <input type="checkbox" checked={ownWallet} onChange={(e) => setOwnWallet(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
          <span>This is my own wallet, not an exchange deposit address. Refunds sent to an exchange can be lost.</span>
        </label>
      )}
    </Disclosure>
  );

  const action = (
    <>
      {err && (
        <Notice tone="danger" title="Can't quote yet" className="mb-3">
          {err}
        </Notice>
      )}
      <button
        type="button"
        onClick={() => {
          if (ctaKind === "near") void connectNear();
          else if (ctaKind === "payer") void connect();
          else if (ctaKind === "quote") void getQuote();
        }}
        disabled={ctaDisabled}
        className={CTA}
      >
        {ctaLabel}
      </button>
      {secondary && <div className="mt-2 flex justify-center text-center">{secondary}</div>}
      <ModeLine live={!dryRun} hint={mode.hint}>
        {mode.text}
      </ModeLine>
    </>
  );

  return (
    <>
      <StakeIntro />
      <FormCard label="Stake NEAR" pay={pay} into={into} summary={summary} details={details} action={action} />

      <HowItWorks />

      {sheet === "source" && (
        <PayWithSheet
          sources={SOURCE_ASSETS}
          pinned={PINNED_CHAINS}
          chain={asset?.chain ?? ""}
          symbol={asset?.symbol ?? ""}
          balances={new Map()}
          hint="Wallets on EVM chains, Solana, TON, Tron and Bitcoin can pay directly; every chain can be paid by hand to the deposit address."
          onPick={(t) => {
            const next = t as SourceAsset;
            setAsset(next);
            const keep = !!payer && payer.family === next.family;
            if (payer && !keep) setPayer(null);
            // same wallet family: refunds still go back to the connected payer (and "Use my wallet" stays hidden for it)
            setRefundTo(keep ? payer!.address : "");
            setOwnWallet(false);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "pool" && (
        <Modal title="Pick a validator" onClose={() => setSheet(null)} wide>
          <ValidatorList
            compact
            picked={target.kind === "native" ? target.pool : undefined}
            onPick={(p) => {
              setPickedPool(p.id);
              setTarget({ kind: "native", pool: p.id });
              setSheet(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}

const percentOrDash = (v: number | null | undefined) => (v === null || v === undefined ? "—" : percent(v));

/** Step timings like a stopwatch: 0:38, 12:05, 1:02:10. */
function mss(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 1Click's refund reason in words: "PRICE_MOVED" → "the price moved before the swap". */
function refundReasonText(reason: string): string {
  const known: Record<string, string> = { PRICE_MOVED: "the price moved before the swap" };
  return known[reason] ?? reason.toLowerCase().replace(/_/g, " ");
}

// ── Review, deposit, tracking, stake ───────────────────────────────────────────────────────────

function QuoteAndTrack({
  stage,
  setStage,
  quote,
  asset,
  target,
  recipient,
  record,
  payer,
  connectingPayer,
  onConnectPayer,
  onRestart,
  manual,
  data,
  epoch,
}: {
  stage: Stage;
  setStage: (s: Stage) => void;
  quote: { req: QuoteRequest; res: QuoteResponse; flowId: string };
  asset: SourceAsset;
  target: Target;
  recipient: string;
  /** The History record when the flow was reopened: its state wins until a fresh 1Click answer arrives. */
  record: FlowRecord | null;
  payer: Payer | null;
  connectingPayer: boolean;
  onConnectPayer: (() => void) | null;
  onRestart: () => void;
  /** The user chose to send it by hand: the deposit address comes first, a wallet second. */
  manual: boolean;
  data: TargetData;
  epoch: NearEpoch | null;
}) {
  const { dryRun, near, demo, setDryRun, connectNear } = useApp();
  const res = quote.res;
  const isDry = quote.req.dry;
  // from a simulation straight to a real quote for the same amount (the form keeps it)
  const goLive = async () => {
    if (!near) {
      if (!(await connectNear())) return;
    } else setDryRun(false);
    onRestart();
  };
  const now = useNow(1000);
  const [liveStatus, setStatus] = useState<StatusResponse | null>(null);
  const [sim, setSim] = useState<{ outcome: SimOutcome; step: number; startedAt: number } | null>(null);
  // a reopened flow that was already staked stays staked: no second "Sign and stake" for the same delivery
  const [stakeState, setStake] = useState<"none" | "ready" | "signing" | "done" | "failed">(record?.staked ? "done" : "none");
  // paid from a connected wallet: the Pay button and the address don't come back until 1Click says it still waits
  const [paidAt, setPaidAt] = useState<number | null>(record?.paidAt ?? null);
  const status = useMemo(() => {
    if (!sim) return liveStatus;
    const list = simulatedStatuses(res, sim.outcome);
    return list[Math.min(sim.step, list.length - 1)]!;
  }, [sim, res, liveStatus]);
  const deadline = isDry ? (sim?.outcome === "expired" ? sim.startedAt + 4000 : null) : quoteDeadline(res);
  const inactiveAt = isDry ? null : addressInactiveAt(res);
  const phase: Phase = phaseOf(status, { deadlineMs: deadline, now, resumed: !!record && !sim });
  const instant = target.kind === "stnear";
  const stake = phase === "delivered" && stakeState === "none" && !instant ? "ready" : stakeState;
  const out = BigInt(res.quote.amountOut);
  const outDecimals = 24;
  const cutoff = payCutoffMs(asset.chain);

  // live: poll 1Click every 5 s until it gives a final answer; past our deadline once a minute, in case it saw a deposit late
  useEffect(() => {
    if (stage !== "track" || isDry || !res.quote.depositAddress || isFinal(phase)) return;
    let live = true;
    const tick = async () => {
      try {
        const s = await getStatus(res.quote.depositAddress!, res.quote.depositMemo);
        if (!live || !s) return;
        setStatus(s);
        const txs = depositTxHashes(s).map((hash) => ({ chain: asset.chain, hash, label: "Deposit" }));
        const d = deliveryTxHash(s);
        updateFlow(quote.flowId, { status: s.status, ...(txs[0] ? { addTx: txs[0] } : {}) });
        if (d) updateFlow(quote.flowId, { addTx: { chain: "near:mainnet", hash: d, label: "Delivery" } });
      } catch {
        // keep polling: 1Click can 404 for a moment after the quote
      }
    };
    void tick();
    const t = setInterval(() => void tick(), phase === "expired" ? 60_000 : 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [stage, isDry, res, phase, quote.flowId, asset.chain]);


  // dry run: replay recorded-shape statuses, labeled as simulated
  useEffect(() => {
    if (!sim || sim.step >= simulatedStatuses(res, sim.outcome).length - 1) return;
    const t = setTimeout(() => setSim({ ...sim, step: sim.step + 1 }), 2200);
    return () => clearTimeout(t);
  }, [sim, res]);

  const view = fundsView(phase, {
    source: `${asset.symbol} on ${asset.chainLabel}`,
    destination: targetLabel(target),
    account: shortAccount(recipient),
    instant,
    stake,
    dry: isDry,
  });
  const appFee = (res.quoteRequest.appFees ?? []).reduce((s, f) => s + f.fee, 0);
  const refundFee = res.quote.refundFee ? BigInt(res.quote.refundFee) : null;
  const left = deadline !== null ? deadline - now : null;

  const onPaid = (hash: string) => {
    const at = Date.now();
    setPaidAt(at);
    updateFlow(quote.flowId, { paidAt: at, addTx: { chain: asset.chain, hash, label: "Deposit" } });
    void submitDepositTx({ txHash: hash, depositAddress: res.quote.depositAddress!, memo: res.quote.depositMemo });
  };
  const simulate = (outcome: SimOutcome) => {
    setSim({ outcome, step: 0, startedAt: Date.now() });
    setStake("none");
    setStage("track");
  };

  // ── what the card shows ──
  const tv = targetView(target, data, recipient);
  const reported = reportedDelivery(status);
  const kept = useKept(target, recipient, isDry, demo, reported);
  const amountIn = BigInt(res.quote.amountIn);
  const amountInText = `${formatUnits(amountIn, asset.decimals)} ${asset.symbol}`;
  const arrived = reported ?? out;
  const stakedEst = !instant && kept.data !== undefined ? stakedFromDelivery(arrived, kept.data) : null;
  const stakedFinal = record?.staked ? BigInt(record.staked) : null;
  const stakedShown = stakedFinal ?? stakedEst;
  const outUsd = res.quote.amountOutUsd ? Number(res.quote.amountOutUsd) : null;
  const usdPerNear = outUsd !== null && out > 0n ? outUsd / (bigintToNumber(out / 10n ** 16n) / 1e8) : null;
  const feeUsd = res.quote.amountInUsd ? (Number(res.quote.amountInUsd) * appFee) / 10_000 : null;
  const feeText = feeUsd === null ? `${(appFee / 100).toFixed(2)}%` : feeUsd < 0.01 ? "< $0.01" : money(feeUsd);
  const eta = duration(res.quote.timeEstimate * 1000);
  const walletName = near?.walletName ?? "your NEAR wallet";
  const unlock = unlockFacts(target, epoch, now);
  const unit = instant ? "stNEAR" : "NEAR";

  // ── timed steps: what this page saw happen, from the payment (or the first sight of the deposit) ──
  const legs = Object.fromEntries(view.legs.map((l) => [l.id, l])) as Record<string, (typeof view.legs)[number]>;
  const delivered = phase === "delivered";
  const finished = instant ? delivered : stake === "done";
  const states: Record<"source" | "intents" | "near" | "pool", StepState> = {
    source: legs.source!.state,
    intents: legs.intents!.state,
    near: delivered ? "done" : legs.near!.state,
    // delivered and not staked: the signature is the user's turn; a failed try leaves the NEAR on the account
    pool: stake === "done" ? "done" : delivered ? (stake === "signing" ? "active" : "waiting") : (legs.pool?.state ?? "todo"),
  };
  const key = Object.values(states).join(",");
  const [seen, setSeen] = useState<{ key: string; at: Partial<Record<keyof typeof states, number>> }>({ key: "", at: {} });
  if (seen.key !== key) {
    // steps already done when the page opened get no time (a reopened flow): only transitions seen here
    const at = { ...seen.at };
    if (seen.key) for (const id of Object.keys(states) as (keyof typeof states)[]) if (states[id] === "done" && at[id] === undefined) at[id] = now;
    setSeen({ key, at });
  }
  const startedAt = sim ? sim.startedAt : (paidAt ?? seen.at.source ?? null);
  const stepTime = (id: keyof typeof states) => {
    const t = seen.at[id];
    return t !== undefined && startedAt !== null && t > startedAt ? mss(t - startedAt) : null;
  };
  const endAt = instant ? seen.at.near : seen.at.pool;
  const elapsed =
    startedAt === null
      ? `Usually about ${eta} after the deposit confirms`
      : endAt !== undefined
        ? `Took ${mss(endAt - startedAt)}`
        : delivered && seen.at.near !== undefined
          ? `NEAR arrived in ${mss(seen.at.near - startedAt)}`
          : isTerminal(phase)
            ? null
            : `${mss(now - startedAt)} elapsed · usually about ${eta}`;

  if (stage === "review") {
    const pay = (
      <Box>
        <div className="flex min-h-5 items-center justify-between gap-4 text-[13px] leading-5 text-muted">
          <span>You pay</span>
          {payer && payer.family === asset.family && (
            <span className="truncate">
              from <span className="font-mono text-text">{shortAccount(payer.address)}</span>
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-[32px] font-semibold leading-[48px] tracking-[-0.02em] tabular-nums sm:text-[40px]">{formatUnits(amountIn, asset.decimals)}</span>
          <PayWithButton asset={asset} />
        </div>
        {res.quote.amountInUsd && <div className="mt-1 text-sm text-muted">≈ {money(Number(res.quote.amountInUsd))}</div>}
      </Box>
    );
    const into = (
      <Box>
        <div className="text-[13px] leading-5 text-muted">{instant ? "You get, straight from 1Click" : "You stake into"}</div>
        <TargetRow avatar={tv.avatar} title={tv.name} meta={tv.meta} badge={tv.badge} />
      </Box>
    );
    const summary = (
      <YouGet
        where={target.kind === "native" ? `Staked in ${tv.short}` : `${tv.short} on your account`}
        big={
          instant
            ? `≈ ${nearAmount(out)} stNEAR`
            : stakedEst === null
              ? <Skeleton className="h-10 w-40" />
              : target.kind === "liquid" && tv.price
                ? `≈ ${nearAmount(sharesFor(stakedEst, tv.price))} ${tv.short}`
                : `≈ ${nearAmount(stakedEst)} NEAR`
        }
        usd={instant ? outUsd : stakedEst !== null && usdPerNear !== null ? usdOf(stakedEst, usdPerNear) : null}
        earns={earnsText(target, stakedEst, tv.apr)}
        unlock={unlock}
        hint={instant ? "From the quote: the stNEAR 1Click delivers." : "From the quote. What is staked is exactly what arrives, minus the gas reserve kept on your account."}
      />
    );
    const details = (
      <Disclosure summary="Details" hint={`Fee ${feeText} · about ${eta}`}>
        <dl className="text-[13px] leading-5">
          <DetailRow label="Swap fee (NEAR Intents)">
            {feeText} <span className="text-muted">({(appFee / 100).toFixed(2)}%)</span>
            {res.quote.withdrawFee && res.quote.withdrawFee !== "0" ? ` · delivery ${formatNear(BigInt(res.quote.withdrawFee), 5)}` : ""}
          </DetailRow>
          <DetailRow label="Arrives in">about {eta} after your deposit confirms</DetailRow>
          <DetailRow label={`${unit} goes to`}>
            <span className="font-mono">{shortAccount(quote.req.recipient)}</span> · ≈ {nearAmount(out)} {unit}
            <span className="block text-muted">
              at least {formatUnits(BigInt(res.quote.minAmountOut), outDecimals, 5)} {unit}
            </span>
          </DetailRow>
          {!instant && (
            <DetailRow label="Kept on your account" hint={<InfoHint label="Why some NEAR stays on your account">{KEPT_HINT}</InfoHint>}>
              {keptText(kept.data)}
            </DetailRow>
          )}
          <DetailRow label="If anything fails">
            Refund to <span className="font-mono">{shortAccount(quote.req.refundTo)}</span> on {asset.chainLabel}
            {refundFee !== null && (
              <span className="block text-muted">
                a refund costs {formatUnits(refundFee, asset.decimals)} {asset.symbol}
              </span>
            )}
          </DetailRow>
          {tv.fee && <DetailRow label={tv.fee.label}>{tv.fee.text}</DetailRow>}
          <DetailRow
            label="Quote check"
            hint={
              <InfoHint label="What the quote check covers">
                {`1Click's answer repeats what this app asked for: recipient ${shortAccount(quote.req.recipient)}, refund ${shortAccount(quote.req.refundTo)}, ${quote.req.destinationAsset}, ${quote.req.recipientType}. ${isDry ? "A dry-run quote can't be paid, so there is nothing to keep; a live quote's signed copy is saved in Recent activity." : "The signed quote is saved in Recent activity."}`}
              </InfoHint>
            }
          >
            <span className="text-accent">Matches what you asked for</span>
          </DetailRow>
        </dl>
      </Disclosure>
    );
    const action = (
      <>
        {isDry ? (
          <>
            <button type="button" onClick={() => simulate("success")} className={CTA}>
              Play the next steps (simulated)
            </button>
            <ModeLine live={false}>Dry-run quote: no deposit address, nothing to pay</ModeLine>
          </>
        ) : (
          <>
            {asset.family && !(manual && !payer) ? (
              <DepositPanel
                variant="cta"
                quote={res}
                dryRun={dryRun}
                asset={asset}
                payer={payer && payer.family === asset.family ? payer : null}
                connecting={connectingPayer}
                onConnectPayer={onConnectPayer}
                cutoffMs={cutoff}
                onPaid={(hash) => {
                  onPaid(hash);
                  setStage("track");
                }}
              />
            ) : (
              <button type="button" onClick={() => setStage("track")} className={CTA}>
                Show the deposit address
              </button>
            )}
            {asset.family && (
              <div className="mt-2 flex justify-center">
                {manual && !payer ? (
                  onConnectPayer && (
                    <button type="button" onClick={onConnectPayer} disabled={connectingPayer} className={QUIET}>
                      {connectingPayer ? "Connecting…" : "Pay from a wallet instead"}
                    </button>
                  )
                ) : (
                  <button type="button" onClick={() => setStage("track")} className={QUIET}>
                    Or send it by hand instead
                  </button>
                )}
              </div>
            )}
            <ModeLine
              live
              hint={instant ? "Next: confirm in your wallet. stNEAR arrives with no NEAR signature." : `Next: confirm in your wallet, then sign once in ${walletName} to stake.`}
            >
              {instant ? "Live quote · no NEAR signature" : `Live quote · then sign once in ${walletName}`}
            </ModeLine>
          </>
        )}
        {/* a dry run can replay other outcomes too */}
        {isDry && (
          <div role="group" aria-labelledby="sim-other" className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-3">
            {/* from lg the label shares the first row with a chip: the right column stays about as tall as the left */}
            <span id="sim-other" className="w-full text-center text-[13px] leading-5 text-muted lg:w-auto">
              Or try another outcome
            </span>
            {SIM_OUTCOMES.filter((o) => o.id !== "success").map((o) => (
              <button key={o.id} type="button" onClick={() => simulate(o.id)} className={`${CHIP} min-h-8 px-3 text-[13px]`}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 flex justify-center">
          <button type="button" onClick={onRestart} className={QUIET}>
            Start over with a new quote
          </button>
        </div>
      </>
    );
    return (
      <>
        <StakeIntro />
        <FormCard label={isDry ? "Dry-run quote" : "Live quote"} pay={pay} into={into} summary={summary} details={details} action={action} />
        <HowItWorks eta={eta} />
      </>
    );
  }

  // ── the tracker ──
  const depositLinks = depositTxHashes(status).map((h) => <ExplorerLink key={h} chain={asset.chain} hash={h} />);
  const deliveryHash = deliveryTxHash(status);
  const fromText = paidAt && payer && payer.family === asset.family ? <>From <span className="font-mono">{shortAccount(payer.address)}</span> on {asset.chainLabel}</> : <>On {asset.chainLabel}</>;
  const showDeposit = !isDry && phase === "awaiting-deposit" && !paidAt;

  const source: TrackStep =
    phase === "unknown"
      ? { id: "source", state: states.source, title: "Checking with 1Click", detail: "Nothing can be paid or staked until it answers." }
      : phase === "awaiting-deposit"
        ? isDry
          ? { id: "source", state: states.source, title: "Dry run: nothing to send", detail: `A live run waits here for ${amountInText} on ${asset.chainLabel}.` }
          : paidAt
            ? {
                id: "source",
                state: states.source,
                title: "Payment sent: waiting for 1Click to see it",
                detail: `Your wallet sent the deposit ${ago(paidAt)}. Don't pay again: this moves on once 1Click indexes it (a few minutes on slow chains).`,
                body: (
                  <button
                    type="button"
                    onClick={() => {
                      setPaidAt(null);
                      updateFlow(quote.flowId, { paidAt: null });
                    }}
                    className={`${QUIET} -ml-2 self-start`}
                  >
                    The payment failed in my wallet: show the deposit again
                  </button>
                ),
              }
            : {
                id: "source",
                state: states.source,
                title: `Send ${amountInText} on ${asset.chainLabel}`,
                detail: "Exactly this amount, once.",
                body: (
                  <DepositPanel
                    quote={res}
                    dryRun={dryRun}
                    asset={asset}
                    payer={payer && payer.family === asset.family ? payer : null}
                    connecting={connectingPayer}
                    onConnectPayer={onConnectPayer}
                    cutoffMs={cutoff}
                    onPaid={onPaid}
                  />
                ),
              }
        : phase === "expired" && !depositLinks.length
          ? { id: "source", state: states.source, title: "No full deposit arrived in time", detail: "Anything sent is refunded, minus the refund fee." }
          : {
              id: "source",
              state: states.source,
              title: sim ? `Payment of ${amountInText} (simulated)` : `We got your ${amountInText}`,
              detail: (
                <>
                  {fromText}
                  {depositLinks.length > 0 && <> · {depositLinks}</>}
                </>
              ),
              time: stepTime("source"),
            };

  const intents: TrackStep = {
    id: "intents",
    state: states.intents,
    title:
      states.intents === "done"
        ? sim
          ? `Swap to ${unit} (simulated)`
          : `Swapped to ${unit}`
        : phase === "deposit-detected"
          ? "Confirming your deposit"
          : phase === "processing"
            ? `Swapping to ${unit}`
            : phase === "incomplete-deposit"
              ? "Less than quoted arrived"
              : phase === "refunded"
                ? "The swap didn't go through"
                : phase === "failed"
                  ? "The swap reported an error"
                  : phase === "expired"
                    ? "The swap didn't start"
                    : `Swap to ${unit}`,
    detail:
      states.intents === "done"
        ? `By NEAR Intents · fee ${feeText}`
        : phase === "deposit-detected"
          ? `Seen on ${asset.chainLabel}, waiting for confirmations`
          : phase === "processing"
            ? "NEAR Intents is swapping it for your account"
            : states.intents === "todo"
              ? `By NEAR Intents, usually about ${eta}`
              : undefined,
    time: stepTime("intents"),
  };

  const nearStep: TrackStep =
    states.near === "done"
      ? {
          id: "near",
          state: "done",
          title: (
            <>
              {sim ? "Would deliver" : "Delivered"} {nearAmount(arrived)} {unit} to <span className="font-mono font-medium">{shortAccount(recipient)}</span>
            </>
          ),
          detail: (
            <>
              {!instant && kept.data !== undefined && kept.data > 0n && `≈ ${nearAmount(kept.data)} NEAR ${sim ? "would stay" : "stays"} for gas`}
              {!instant && kept.data !== undefined && kept.data > 0n && deliveryHash && " · "}
              {deliveryHash && <ExplorerLink chain="near:mainnet" hash={deliveryHash} />}
            </>
          ),
          time: stepTime("near"),
        }
      : {
          id: "near",
          state: states.near,
          title: (
            <>
              {unit} lands in <span className="font-mono font-medium">{shortAccount(recipient)}</span>
            </>
          ),
          detail: `≈ ${nearAmount(out)} ${unit}`,
        };

  const steps: TrackStep[] = [source, intents, nearStep];
  if (!instant) {
    const already = phase === "delivered" && stakeState === "done" && !!record?.staked;
    steps.push(
      already
        ? {
            id: "pool",
            state: "done",
            title: `Staked ${nearAmount(BigInt(record!.staked!))} NEAR in ${tv.short}`,
            detail: (
              <>
                Already staked.{" "}
                <Link href="/portfolio" className="text-accent hover:underline">
                  See it in Portfolio
                </Link>
              </>
            ),
          }
        : phase === "delivered"
          ? {
              id: "pool",
              state: states.pool,
              boxed: stake !== "done",
              time: stepTime("pool"),
              body: (
                <StakeStep target={target} recipient={recipient} status={status} simulated={!!sim} onGoLive={sim ? goLive : undefined} flowId={quote.flowId} attemptedAt={record?.stakeAttemptAt ?? null} stake={stake} setStake={setStake} apr={tv.apr} />
              ),
            }
          : { id: "pool", state: states.pool, title: "Sign once to stake", detail: `${cap(walletName)} asks you to confirm. It stakes exactly what arrived.` },
    );
  }
  const done = steps.filter((s) => s.state === "done").length;
  // refunded, failed or past the deadline: the steps after the one that stopped won't happen
  const stopped = view.tone === "bad";
  if (stopped) {
    const at = steps.findIndex((s) => s.state === "failed");
    if (at >= 0) steps.splice(at + 1);
  }
  if (!stopped) steps.push({
    id: "earn",
    state: finished ? "done" : "todo",
    title: instant ? "Earning with Meta Pool" : tv.apr !== null ? `Earning ${percent(tv.apr)} a year` : "Earning a yearly reward",
    detail:
      target.kind === "native"
        ? epoch
          ? `Rewards start with the next epoch, in about ${duration(Math.max(0, epoch.endsAt - now))}`
          : "Rewards start with the next epoch"
        : `${tv.short} grows in NEAR value every epoch`,
  });

  const badge: { label: string; tone: StatusTone; pulse?: boolean } = sim
    ? { label: "Simulation", tone: "neutral" }
    : phase === "unknown"
      ? { label: "Checking", tone: "neutral" }
      : phase === "awaiting-deposit"
        ? isDry
          ? { label: "Dry run", tone: "neutral" }
          : paidAt
            ? { label: "Waiting for 1Click", tone: "progress", pulse: true }
            : { label: "Your turn", tone: "attention" }
        : phase === "deposit-detected" || phase === "processing"
          ? { label: "In progress", tone: "progress", pulse: true }
          : phase === "incomplete-deposit"
            ? { label: "Less arrived", tone: "attention" }
            : phase === "delivered"
              ? finished
                ? { label: "Done", tone: "success" }
                : { label: "Your turn", tone: "attention" }
              : phase === "refunded"
                ? { label: "Refunded", tone: "danger" }
                : phase === "failed"
                  ? { label: "Failed", tone: "danger" }
                  : { label: "Deadline passed", tone: "danger" };

  const routeNodes: RouteNode[] = [
    { id: "source", icon: <TokenIcon asset={asset} ring="ring-surface" />, title: `${asset.symbol} on ${asset.chainLabel}`, short: asset.symbol, caption: amountInText, state: states.source },
    {
      id: "intents",
      icon: (
        <span className="grid size-8 place-items-center rounded-full border border-line bg-panel">
          <IntentsGlyph />
        </span>
      ),
      title: "NEAR Intents",
      short: "Intents",
      caption: "swap",
      state: states.intents,
    },
    {
      id: "near",
      icon: (
        <span className="grid size-8 place-items-center rounded-full bg-accent">
          <svg viewBox="0 0 512 512" aria-hidden className="size-4">
            <path d={NEAR_N_PATH} fill="var(--accent-ink)" />
          </svg>
        </span>
      ),
      title: shortAccount(recipient),
      caption: `${reported !== null ? "" : "≈ "}${nearAmount(arrived)} ${unit}`,
      state: states.near,
      mono: true,
    },
  ];
  if (!instant)
    routeNodes.push({
      id: "pool",
      icon: <PoolAvatar name={tv.short} tone={target.kind === "liquid" ? "liquid" : "pool"} size={32} />,
      title: tv.short,
      caption: stakedShown !== null ? `${stakedFinal !== null ? "" : "≈ "}${nearAmount(stakedShown)} NEAR` : "stake",
      state: states.pool,
    });

  const showDeadline = left !== null && !isTerminal(phase) && phase !== "processing" && phase !== "unknown" && !showDeposit;
  const safeToClose = !isDry && ((!isTerminal(phase) && phase !== "unknown" && phase !== "incomplete-deposit" && (phase !== "awaiting-deposit" || !!paidAt)) || (delivered && !finished));

  return (
    <CardShell
      id="track-title"
      heading="h1"
      wide
      title={sim ? `Simulated stake of ${amountInText}` : instant ? `Getting stNEAR for ${amountInText}` : `Staking ${amountInText}`}
      sub={
        <>
          {instant
            ? `≈ ${nearAmount(out)} stNEAR to ${shortAccount(recipient)}`
            : `${stakedFinal !== null ? "" : "≈ "}${nearAmount(stakedShown ?? out)} NEAR into ${tv.short}${tv.apr !== null ? ` · ${percent(tv.apr)} APR` : ""}`}
          {sim && <span className="block text-[13px] text-warn">Simulation: nothing is paid, delivered or staked</span>}
        </>
      }
      right={
        <StatusBadge tone={badge.tone} pulse={badge.pulse}>
          {badge.label}
        </StatusBadge>
      }
    >
      <div className="mt-6">
        <RouteStrip
          nodes={routeNodes}
          label={`Route: ${asset.symbol} on ${asset.chainLabel}, then NEAR Intents, then ${shortAccount(recipient)}${instant ? "" : `, then ${tv.short}`}`}
        />
      </div>
      <p role="status" className="sr-only">
        {view.headline}
      </p>

      <div className="mt-6">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[13px] leading-5">
          <span className="font-medium">
            {stopped ? `Stopped after ${done} of ${instant ? 3 : 4} steps` : `${done} of ${instant ? 3 : 4} steps done`}
          </span>
          {elapsed && <span className="text-muted">{elapsed}</span>}
        </div>
        <div
          role="progressbar"
          aria-label="Stake progress"
          aria-valuemin={0}
          aria-valuemax={instant ? 3 : 4}
          aria-valuenow={done}
          aria-valuetext={`${done} of ${instant ? 3 : 4} steps done`}
          className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${view.tone === "bad" ? "bg-danger" : "bg-accent"}`}
            style={{ width: `${(done / (instant ? 3 : 4)) * 100}%` }}
          />
        </div>
        {showDeadline && left !== null && (
          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[13px] leading-5 text-muted">
            Refund deadline
            <span className={`font-mono tabular-nums ${left < cutoff ? "text-danger" : "text-text"}`}>{left > 0 ? clock(left) : "passed"}</span>
            <InfoHint label="About the deadline">
              {`The refund begins then: a deposit after it is refunded (minus the refund fee). Paying stops ${Math.round(cutoff / 60_000)} min before it.${inactiveAt !== null && inactiveAt > (deadline ?? 0) ? ` The address goes inactive later, at ${dateTime(inactiveAt)}: never send to it after that.` : ""}`}
            </InfoHint>
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3 empty:hidden">
        {phase === "unknown" && (
          <Notice tone="attention" title={status ? `1Click says ${status.status}` : "Checking the swap status"}>
            {status
              ? "This app doesn't know that status, so nothing is offered to pay or stake. The signed quote is in Recent activity (Portfolio); 1Click support can look it up by the deposit address."
              : "Asking 1Click where this swap is. Nothing can be paid or staked until it answers."}
          </Notice>
        )}
        {phase === "incomplete-deposit" && <TopUp res={res} status={status} asset={asset} refundTo={quote.req.refundTo} left={left} />}
        {phase === "refunded" && (
          <Notice tone="danger" title="Refunded">
            {status?.swapDetails.refundedAmount
              ? `${formatUnits(BigInt(status.swapDetails.refundedAmount), asset.decimals)} ${asset.symbol} went back to ${shortAccount(quote.req.refundTo)}${status.swapDetails.refundReason ? `: ${refundReasonText(status.swapDetails.refundReason)}` : ""}.`
              : `The deposit went back to ${shortAccount(quote.req.refundTo)} on ${asset.chainLabel}, minus the refund fee.`}{" "}
            Nothing reached NEAR, so there is nothing to unstake.
          </Notice>
        )}
        {phase === "failed" && (
          <Notice tone="danger" title="1Click reports the swap failed">
            {isDry ? (
              "In a live run: check your refund address for a refund. If nothing arrives, contact 1Click support with the deposit address and the signed quote saved in Recent activity."
            ) : (
              <>
                Check {shortAccount(quote.req.refundTo)} on {asset.chainLabel} for a refund. If nothing arrives, contact 1Click support with the deposit address{" "}
                <span className="break-all font-mono text-xs">{res.quote.depositAddress}</span>; the signed quote is saved in Recent activity.
              </>
            )}
          </Notice>
        )}
        {phase === "expired" && (
          <Notice tone="danger" title="Deadline passed">
            No full deposit arrived in time. Anything sent goes back to {shortAccount(quote.req.refundTo)} on {asset.chainLabel}, minus the refund fee.{" "}
            {isDry ? "In a live run this page keeps asking" : "This page keeps asking"} 1Click once a minute in case it saw a deposit late.
          </Notice>
        )}
      </div>

      {(phase === "refunded" || phase === "failed" || phase === "expired") && (
        <button type="button" onClick={onRestart} className={`${CTA} mt-4`}>
          Try again with a new quote
        </button>
      )}

      <div className="mt-6">
        <StepList steps={steps} />
      </div>

      {safeToClose && (
        <Notice
          className="mt-6"
          icon={<ShieldCheckIcon size={16} />}
          tone="neutral"
        >
          <span className="font-semibold text-text">{delivered ? "Safe to close." : "Safe to close: this keeps going."}</span>{" "}
          {delivered
            ? `Your NEAR waits in ${shortAccount(recipient)} until you sign.`
            : `${unit} lands in ${shortAccount(recipient)}${instant ? "" : " and waits there until you sign"}.`}{" "}
          Come back any time from{" "}
          <Link href="/portfolio#activity" className="text-accent hover:underline">
            Portfolio
          </Link>
          .
        </Notice>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        {phase === "refunded" || phase === "failed" || phase === "expired" ? (
          <span />
        ) : (
          <button type="button" onClick={onRestart} className={`${QUIET} -ml-2`}>
            Start a new stake
          </button>
        )}
        <Link href="/portfolio" className={`${QUIET} -mr-2`}>
          Go to Portfolio
        </Link>
      </div>
    </CardShell>
  );
}

/**
 * Less than quoted arrived. 1Click's docs say only that an EXACT_INPUT deposit below amountIn is
 * refunded by the deadline, so no top-up is suggested: the user waits for the refund and quotes again.
 */
function TopUp({ res, status, asset, refundTo, left }: { res: QuoteResponse; status: StatusResponse | null; asset: SourceAsset; refundTo: string; left: number | null }) {
  const got = status?.swapDetails.depositedAmount ? BigInt(status.swapDetails.depositedAmount) : 0n;
  return (
    <Notice tone="attention" title="Less than quoted arrived">
      {formatUnits(got, asset.decimals)} {asset.symbol} arrived of {formatUnits(BigInt(res.quote.amountIn), asset.decimals)} (an exchange may have taken its fee). 1Click refunds it to{" "}
      {shortAccount(refundTo)} at the deadline{left !== null && left > 0 ? `, in ${clock(left)}` : ""}, minus the refund fee. Then start a new quote and send the exact amount from a
      wallet.
    </Notice>
  );
}

/** What the account holds in the target now: staked NEAR in the pool, or the liquid token's base units. */
async function heldInTarget(target: Target, native: ReturnType<typeof nativeStaking>, liquid: ReturnType<typeof liquidStaking> | null): Promise<bigint> {
  if (liquid) return (await liquid.getAccountDetails()).shares;
  const pool = (target as { pool: string }).pool;
  const p = (await native.getStakedBalance()).positions.find((x) => x.pool === pool);
  return p?.staked ?? 0n;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function StakeStep({
  target,
  recipient,
  status,
  simulated,
  onGoLive,
  flowId,
  attemptedAt,
  stake,
  setStake,
  apr,
}: {
  target: Target;
  recipient: string;
  status: StatusResponse | null;
  simulated: boolean;
  /** Simulation only: leave it for a real quote (switch to Live, or connect a wallet first). */
  onGoLive?: () => Promise<void>;
  flowId: string;
  /** A stake was signed for this delivery earlier and its result was never confirmed (from History). */
  attemptedAt: number | null;
  stake: "none" | "ready" | "signing" | "done" | "failed";
  setStake: (s: "none" | "ready" | "signing" | "done" | "failed") => void;
  /** The target's APR as the card shows it, until the preflight reads it fresh. */
  apr: number | null;
}) {
  const { near, demo } = useApp();
  const signing = !!near && near.accountId === recipient && !simulated;
  const account = signing ? near!.account : demo;
  const native = useMemo(() => nativeStaking(account), [account]);
  const liquid = useMemo(() => (target.kind === "liquid" ? liquidStaking(account, target.preset) : null), [account, target]);
  const [amount, setAmount] = useState<StakeAmount | null>(null);
  const [amountErr, setAmountErr] = useState("");
  const [preflight, setPreflight] = useState<NearStakeQuote | LiquidStakeQuote | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [staked, setStaked] = useState<bigint | null>(null);
  // a stake from an earlier visit may have landed: signing again needs the user to have checked
  const [unconfirmed, setUnconfirmed] = useState<number | null>(attemptedAt);
  const [checkedNotStaked, setCheckedNotStaked] = useState(false);
  const once = useRef(false);

  // exactly what was delivered, capped by what the account can spend now; read fresh for every preflight
  const computeAmount = useCallback(async (): Promise<StakeAmount> => {
    const reported = reportedDelivery(status);
    const delivery = deliveryTxHash(status);
    const onChain = !simulated && delivery ? await deliveredOnChain(delivery, recipient) : null;
    // a simulated delivery never reached the account: a brand-new implicit account keeps its storage plus
    // what the module keeps back (the stake's upfront gas and the reserve that pays for the exit)
    const maxStakeable = simulated
      ? (reported ?? 0n) - FRESH_ACCOUNT_STORAGE - (await stakeOverhead(liquid ?? native, nearClient().rpc))
      : liquid
        ? await liquid.getMaxStakeable()
        : await native.getMaxStakeable();
    return stakeAmountAfterDelivery({ reported, onChain, maxStakeable, minStake: MIN_STAKE });
  }, [status, simulated, recipient, native, liquid]);

  const runPreflight = useCallback(async () => {
    setErr("");
    setAmountErr("");
    setBusy(true);
    try {
      let a: StakeAmount;
      try {
        a = await computeAmount();
        setAmount(a);
      } catch (e) {
        setAmount(null);
        setPreflight(null);
        setAmountErr(stakingErrorText(e));
        return;
      }
      if (a.tooSmall) {
        setPreflight(null);
        return;
      }
      const q = liquid ? await liquid.quoteStake({ amount: a.amount }) : await native.quoteStake({ amount: a.amount, pool: (target as { pool: string }).pool });
      setPreflight(q);
    } catch (e) {
      setPreflight(null);
      setErr(stakingErrorText(e));
    } finally {
      setBusy(false);
    }
  }, [computeAmount, liquid, native, target]);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    void runPreflight();
  }, [runPreflight]);

  const markStaked = (value: bigint, txHash: string | null) => {
    setStaked(value);
    setHash(txHash);
    setUnconfirmed(null);
    updateFlow(flowId, { staked: value.toString(), stakeAttemptAt: null, ...(txHash ? { addTx: { chain: "near:mainnet", hash: txHash, label: "Stake" } } : {}) });
    setStake("done");
  };

  const sign = async () => {
    if (!preflight || !amount) return;
    setErr("");
    setStake("signing");
    // what the target holds before: if the wallet errors after broadcasting, the chain still tells whether it landed
    const before = await heldInTarget(target, native, liquid).catch(() => null);
    const expectedGain = liquid ? (preflight as LiquidStakeQuote).shares : amount.amount;
    updateFlow(flowId, { stakeAttemptAt: Date.now() });
    try {
      const r = liquid
        ? await liquid.stake({ amount: amount.amount, expected: preflight.transactions })
        : await native.stake({ amount: amount.amount, pool: (target as { pool: string }).pool, expected: preflight.transactions });
      markStaked(amount.amount, r.hash);
    } catch (e) {
      const rejected = (e as { name?: string })?.name === "UserRejectedError";
      if (rejected) {
        updateFlow(flowId, { stakeAttemptAt: null });
        setErr("You cancelled in the wallet. Nothing was sent.");
        setStake("failed");
        return;
      }
      // any other error may come after the broadcast: look at the chain twice before offering to sign again
      setErr(`${stakingErrorText(e)} Checking the chain before you can try again…`);
      for (let i = 0; i < 2 && before !== null; i++) {
        await sleep(6000);
        const after = await heldInTarget(target, native, liquid).catch(() => null);
        if (after !== null && after - before >= (expectedGain * 999n) / 1000n) {
          markStaked(amount.amount, null);
          return;
        }
      }
      setUnconfirmed(before === null ? Date.now() : null);
      setPreflight(null);
      setErr(`${stakingErrorText(e)} ${before === null ? "The position couldn't be read, so check Portfolio before you sign again." : "The stake isn't on chain after 12 s. Preflight again to retry."}`);
      setStake("failed");
    }
  };

  const short = targetShort(target);
  if (stake === "done")
    return (
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-6">
          <span className="sr-only">Done: </span>Staked {nearAmount(staked ?? amount?.amount ?? 0n)} NEAR in {short}
        </p>
        <p className="text-[13px] leading-5 text-muted">
          {hash && (
            <>
              <ExplorerLink chain="near:mainnet" hash={hash} /> ·{" "}
            </>
          )}
          <Link href="/portfolio" className="text-accent hover:underline">
            See it in Portfolio
          </Link>
        </p>
      </div>
    );

  const blocked = unconfirmed !== null && !checkedNotStaked;
  const walletName = near?.walletName ?? "your NEAR wallet";
  const shownApr = preflight?.apr ?? apr;
  const willStake = amount && !amount.tooSmall ? `${nearAmount(amount.amount)} NEAR` : null;
  const delivered = reportedDelivery(status);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div>
        <p className="text-base font-semibold leading-6">
          {simulated ? (
            <>In a live run: sign to stake {willStake ?? "it"}</>
          ) : (
            <>
              <span className="sr-only">Your turn: </span>NEAR arrived — sign to stake {willStake ?? "it"}
            </>
          )}
        </p>
        <p className="mt-1 text-sm leading-5 text-muted">
          {signing ? `${cap(walletName)} opens and asks you to confirm. ` : ""}It {simulated ? "would stake" : "stakes"} into {short}
          {shownApr !== null ? ` at ${percent(shownApr)} APR` : ""}.
        </p>
      </div>
      {amount ? (
        <dl className="border-y border-line py-1.5 text-[13px] leading-5">
          <DetailRow label="Delivered" hint={<InfoHint label="Where this figure comes from">{amount.basis === "on-chain" ? "Read from the NEAR transaction." : "As 1Click reports it."}</InfoHint>}>
            {delivered !== null ? <span title={formatNear(delivered, 24)}>{nearAmount(delivered)} NEAR</span> : "—"}
            {amount.mismatch && <span className="block text-warn">the NEAR transaction and 1Click differ: the lower figure is staked</span>}
          </DetailRow>
          <DetailRow label="Will stake">
            <span className="font-semibold text-accent" title={amount.tooSmall ? undefined : formatNear(amount.amount, 24)}>
              {amount.tooSmall ? "too small to stake" : willStake}
            </span>
            <span className="block text-muted">{amount.capped ? "the delivery minus the gas reserve kept on your account" : "exactly the delivery"}</span>
          </DetailRow>
        </dl>
      ) : amountErr ? (
        <p className="text-sm text-danger">{amountErr}</p>
      ) : (
        <Spinner />
      )}
      {preflight?.warnings.map((w) => (
        <p key={w.code} className="text-sm text-warn">
          {w.message}
        </p>
      ))}
      {unconfirmed !== null && (
        <Notice tone="attention" title="A stake may already have gone through">
          A stake for this delivery was signed {ago(unconfirmed)} and its result wasn&apos;t confirmed. Check Portfolio first: signing again would stake other NEAR on the account.
          <label className="mt-2 flex min-h-11 items-start gap-2.5 text-sm">
            <input type="checkbox" checked={checkedNotStaked} onChange={(e) => setCheckedNotStaked(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
            <span>I checked Portfolio: this delivery is not staked.</span>
          </label>
        </Notice>
      )}
      {err && (
        <Notice tone={simulated ? "attention" : "danger"} title={simulated ? "Preflight on the demo account" : stake === "signing" ? "Wallet error" : "Preflight refused"}>
          {err}
          {simulated ? " In a live run the delivery itself funds the stake." : ""}
        </Notice>
      )}
      {simulated && onGoLive ? (
        <button type="button" onClick={() => void onGoLive()} className={CTA}>
          {near ? "Stake for real: switch to Live" : "Connect NEAR wallet to stake for real"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void sign()}
          disabled={!signing || !preflight || stake === "signing" || busy || blocked}
          className={`${CTA} ${signing ? "" : "disabled:bg-surface disabled:text-muted disabled:opacity-100 disabled:shadow-none"}`}
          title={signing ? undefined : "Dry run / demo account: nothing to sign"}
        >
          {stake === "signing"
            ? "Confirm in your wallet…"
            : signing
              ? `Sign and stake${willStake ? ` ${willStake}` : ""} in ${walletName}`
              : simulated
                ? "Sign and stake (live runs only)"
                : "Sign and stake"}
        </button>
      )}
      {!signing && (
        <p className="text-[13px] leading-5 text-muted">
          {simulated
            ? "Nothing was paid or delivered. A live quote for the same amount costs nothing; you pay only after you confirm in your wallet."
            : near
              ? `This stake is for ${shortAccount(recipient)}: connect that account to sign.`
              : `Connect the NEAR wallet for ${shortAccount(recipient)} to sign.`}
        </p>
      )}
      {/* "Check again" sits beside the toggle; the opened preview takes the box's full width under both */}
      <div className="relative min-h-11">
        {preflight && (
          <Disclosure variant="plain" summary="What you'll sign" defaultOpen={signing} className="pr-28" bodyClassName="-mr-28 flex flex-col gap-2 pb-1">
            <TxPreview transactions={preflight.transactions} title="The transaction, as the staking module built it" />
            <p className="text-xs leading-4 text-muted">
              Network fee at most {formatNear(preflight.fee, 5)} · {formatNear(preflight.upfront, 4)} held back for gas while it runs (refunded) · {formatNear(preflight.reserve, 4)}{" "}
              stays on the account for the unstake{preflight.apr !== null ? ` · APR ${percent(preflight.apr)}` : ""}
            </p>
            <p className="text-xs leading-4 text-muted">
              The check reads the delivered amount, pool code, pause, fee, validator set and balances fresh. NEAR has no transaction simulation, so nothing runs until you sign; the
              signed transaction must equal this preview.
            </p>
          </Disclosure>
        )}
        {!simulated && (
          <button type="button" onClick={() => void runPreflight()} disabled={busy || stake === "signing"} className={`${QUIET} absolute -right-2 top-0`}>
            {busy ? "Checking…" : "Check again"}
          </button>
        )}
      </div>
    </div>
  );
}

export type { NearPoolInfo };
