"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KNOWN_MINIMUM_USD, MEMO_CHAINS, NEAR_ICON, PINNED_CHAINS, SOURCE_ASSETS, findAsset, looksLikeAddress, type SourceAsset } from "@/lib/assets";
import { addRecord, getFlow, newId, updateFlow, type FlowRecord } from "@/lib/history";
import { DEMO_ACCOUNT, SUGGESTED_POOL } from "@/lib/near/config";
import { checkRecipient, deliveredOnChain, instantStNearEligible, nearClient } from "@/lib/near/reads";
import { getStatus, listTokens, requestQuote, submitDepositTx } from "@/lib/oneclick/client";
import { addressInactiveAt, buildInboundQuoteRequest, deadlineMsFor, payCutoffMs, quoteDeadline } from "@/lib/oneclick/quote";
import { SIM_OUTCOMES, simulatedStatuses, type SimOutcome } from "@/lib/oneclick/simulate";
import { deliveryTxHash, depositTxHashes, fundsView, isFinal, isTerminal, phaseOf, reportedDelivery, type Phase } from "@/lib/oneclick/status";
import type { QuoteRequest, QuoteResponse, StatusResponse } from "@/lib/oneclick/types";
import { connectPayer, PAYER_LABEL, type Payer } from "@/lib/pay";
import { ago, clock, dateTime, duration, formatNear, formatUnits, money, parseUnits, percent, shortAccount } from "@/lib/format";
import { stakeAmountAfterDelivery, type StakeAmount } from "@/lib/stakeAmount";
import {
  LIQUID_OPTIONS, MIN_STAKE, liquidStaking, nativeStaking, poolStatus, refusalText, stakeOverhead, stakingErrorText,
  type LiquidPreset, type LiquidStakeQuote, type NearPoolInfo, type NearStakeQuote,
} from "@/lib/staking";
import { DRY_REFUND } from "@/lib/dryrun";
import { useAsync, useNow } from "@/lib/useAsync";
import { useApp } from "./AppProvider";
import { DepositPanel } from "./DepositPanel";
import { FundsRoute, IntentsGlyph } from "./FundsRoute";
import { LogoMark } from "./Logo";
import { Modal } from "./Modal";
import { PayWithSheet } from "./PayWithSheet";
import { TxLink } from "./TxLink";
import { TxPreview } from "./TxPreview";
import { ValidatorList } from "./ValidatorList";
import { Banner, Icon, Panel, Pill, PillTabs, Row, Rows, Spinner } from "./ui";

export type Target = { kind: "native"; pool: string } | { kind: "liquid"; preset: LiquidPreset } | { kind: "stnear" };

/** Storage a fresh implicit account holds after the delivery creates it (182 bytes, mainnet tx AQAkvxyT…). */
const FRESH_ACCOUNT_STORAGE = 182n * 10n ** 19n;

const targetLabel = (t: Target) => (t.kind === "native" ? t.pool : t.kind === "liquid" ? LIQUID_OPTIONS.find((o) => o.id === t.preset)!.symbol : "stNEAR");
const targetKey = (t: Target) => (t.kind === "native" ? `native:${t.pool}` : t.kind === "liquid" ? `liquid:${t.preset}` : "stnear");

function parseTarget(key: string | undefined): Target | null {
  if (!key) return null;
  if (key === "stnear") return { kind: "stnear" };
  if (key.startsWith("native:")) return { kind: "native", pool: key.slice(7) };
  if (key.startsWith("liquid:")) return { kind: "liquid", preset: key.slice(7) as LiquidPreset };
  return null;
}

type Stage = "setup" | "review" | "track";

export function StakeFlow() {
  const params = useSearchParams();
  const { near, dryRun, demo } = useApp();
  // a flow reopened from Recent activity (?flow=…) resumes at its status; this component renders on the client only
  const [resumed] = useState(() => {
    const id = params.get("flow");
    const r = id ? getFlow(id) : null;
    const t = r ? parseTarget(r.target) : null;
    return r && t ? { r, t } : null;
  });
  const [target, setTarget] = useState<Target>(() => resumed?.t ?? { kind: "native", pool: params.get("pool") || SUGGESTED_POOL });
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

  const recipient = near?.accountId ?? (dryRun ? DEMO_ACCOUNT : null);
  const amount = asset ? parseUnits(amountText, asset.decimals) : null;
  const prices = useAsync(() => listTokens().then((ts) => new Map(ts.map((t) => [t.assetId, t.price]))), []);
  const price = asset ? prices.data?.get(asset.assetId) : undefined;
  const usd = amount !== null && price && asset ? Number(formatUnits(amount, asset.decimals, 8).replace(/,/g, "")) * price : null;
  const minUsd = asset ? KNOWN_MINIMUM_USD[asset.chain] : undefined;

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
    if (!refund) return setErr(`Enter your own ${asset.chainLabel} address for refunds.`);
    if (!looksLikeAddress(asset.chain, refund)) return setErr(`That doesn't look like a ${asset.chainLabel} address.`);
    if (!dryRun && !ownWallet && payer?.address !== refund) return setErr("Confirm the refund address is your own wallet, not an exchange deposit address.");
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
      />
    );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel className="flex flex-col gap-6 p-4 sm:p-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">1 · What to stake into</h2>
          <PillTabs
            tabs={[
              { id: "native", label: "Validator pool" },
              { id: "liquid", label: "Liquid (rNEAR / LiNEAR)" },
              { id: "stnear", label: "Instant stNEAR" },
            ]}
            value={target.kind}
            onChange={(k) => setTarget(k === "native" ? { kind: "native", pool: target.kind === "native" ? target.pool : SUGGESTED_POOL } : k === "liquid" ? { kind: "liquid", preset: "rnear" } : { kind: "stnear" })}
          />
          {target.kind === "native" && <PoolCard pool={target.pool} onChange={() => setSheet("pool")} />}
          {target.kind === "liquid" && <LiquidPicker preset={target.preset} onPick={(p) => setTarget({ kind: "liquid", preset: p })} />}
          {target.kind === "stnear" && <InstantCard recipient={recipient} />}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">2 · Pay with</h2>
          <button type="button" onClick={() => setSheet("source")} className="btn-tactile justify-between px-4 py-3 text-left">
            {asset ? (
              <span className="flex items-center gap-3">
                <span className="relative">
                  <Icon src={asset.icon} alt={asset.symbol} size={32} />
                  {asset.chainIcon !== asset.icon && (
                    <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-surface">
                      <Icon src={asset.chainIcon} alt="" size={14} />
                    </span>
                  )}
                </span>
                <span className="flex flex-col">
                  <span className="font-medium">{asset.symbol}</span>
                  <span className="text-xs text-muted">on {asset.chainLabel}</span>
                </span>
              </span>
            ) : (
              <span>Pick a token</span>
            )}
            <span className="text-sm text-muted">Change</span>
          </button>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted">Amount</span>
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 focus-within:border-accent">
              <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" aria-label="Amount" className="min-w-0 flex-1 bg-transparent py-3 text-lg tabular-nums outline-none" />
              <span className="text-muted">{asset?.symbol}</span>
            </div>
            <span className="text-xs text-muted">
              {usd !== null ? `≈ ${money(usd)}` : " "}
              {minUsd && usd !== null && usd < minUsd ? ` · ${asset?.chainLabel} currently has a $${minUsd} minimum` : ""}
            </span>
          </label>
          {price && asset && (
            <div className="flex flex-wrap gap-2">
              {[5, 20, 50, 100].map((d) => (
                <button key={d} type="button" onClick={() => setAmountText(formatUnits(BigInt(Math.round((d / price) * 10 ** Math.min(asset.decimals, 8))) * 10n ** BigInt(Math.max(0, asset.decimals - 8)), asset.decimals, 6).replace(/,/g, ""))} className="btn-tactile px-3 py-1.5 text-sm">
                  ${d}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">3 · Refunds and delivery</h2>
          <Rows>
            <Row label="NEAR delivered to" hint="always your connected account">
              <span className="font-mono">{recipient ? shortAccount(recipient) : "connect a NEAR wallet"}</span>
              {!near && recipient && <span className="block text-xs text-warn">dry run: the demo account</span>}
            </Row>
          </Rows>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted">Refund address on {asset?.chainLabel ?? "the source chain"}</span>
            <input
              value={refundTo}
              onChange={(e) => {
                setRefundTo(e.target.value);
                // a ticked "my own wallet" vouched for the old text, not this one
                setOwnWallet(false);
              }}
              placeholder={dryRun ? (asset?.family && DRY_REFUND[asset.family] ? "optional in dry run (a burn address stands in)" : "needed even in dry run for this chain") : "your own wallet address"}
              spellCheck={false}
              className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-mono text-sm outline-none focus:border-accent"
            />
          </label>
          {asset?.family && !payer && (
            <button type="button" onClick={() => void connect()} disabled={connectingPayer} className="btn-tactile self-start px-3.5 py-2 text-sm font-medium">
              {connectingPayer ? "Connecting…" : `Use my ${PAYER_LABEL[asset.family]}`}
            </button>
          )}
          {payer && <p className="text-xs text-muted">Paying from {payer.label} · {shortAccount(payer.address)}</p>}
          {!dryRun && payer?.address !== refundTo.trim() && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={ownWallet} onChange={(e) => setOwnWallet(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
              <span>This is my own wallet, not an exchange deposit address. Refunds sent to an exchange can be lost.</span>
            </label>
          )}
        </section>

        {err && <Banner tone="danger" title="Can't quote yet">{err}</Banner>}
        <button type="button" onClick={() => void getQuote()} disabled={quoting || !asset} className="btn-tactile-accent btn-tactile-lg justify-center px-6 py-3.5 text-base">
          {quoting ? "Getting a quote…" : dryRun ? "Get a dry-run quote" : "Get quote"}
        </button>
      </Panel>

      <aside className="flex flex-col gap-3">
        <Banner tone={dryRun ? "warn" : "accent"} title={dryRun ? "Dry run is on" : "Live mode"}>
          {dryRun ? "Real 1Click quotes and real pool checks. No deposit address is shown and nothing can be paid." : "Quotes are payable. Your NEAR account receives the delivery; you sign the stake."}
        </Banner>
        <Facts />
      </aside>

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
              setTarget({ kind: "native", pool: p.id });
              setSheet(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function Facts() {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
      <p className="font-medium text-text">Good to know</p>
      <p>An epoch is about 7 h (43 200 blocks; the clock on Portfolio is measured). Native unstaking takes 4 epoch boundaries: about 21–28 h.</p>
      <p>rNEAR and LiNEAR unstake in 4–5+ epochs (≈ 21–35 h or more); the exact epoch shows after you unstake.</p>
      <p>
        About 0.05 NEAR stays on your account so you can unstake later: NEAR holds back a transaction&apos;s prepaid gas when it accepts it and refunds the unused part seconds later. A
        brand-new implicit account is created by the delivery itself.
      </p>
      <p>Only the NEAR delivered by this swap is staked, never what was already on your account.</p>
    </div>
  );
}

function PoolCard({ pool, onChange }: { pool: string; onChange: () => void }) {
  const { demo } = useApp();
  const staking = useMemo(() => nativeStaking(demo), [demo]);
  const info = useAsync(() => staking.getPool(pool), [staking, pool]);
  const p = info.data;
  const st = p ? poolStatus(p) : null;
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{pool}</p>
          <p className="text-sm text-muted">
            {p ? (
              <>
                {p.feePercent !== null ? `${percent(p.feePercent, 0)} fee` : "fee —"} · <span className="text-accent">{percent(p.apr)} APR</span> · {formatUnits(p.stake / 10n ** 24n, 0)} NEAR staked
              </>
            ) : info.error ? (
              info.error
            ) : (
              <Spinner />
            )}
          </p>
        </div>
        <button type="button" onClick={onChange} className="btn-tactile shrink-0 px-3 py-1.5 text-sm font-medium">
          Change
        </button>
      </div>
      {p && st && (
        <div className="flex flex-wrap gap-1.5">
          <Pill tone={st.tone}>{st.label}</Pill>
          {p.codeHashKnown && <Pill>standard pool code</Pill>}
          {p.paused === false && <Pill>not paused</Pill>}
          {p.inNextSet && <Pill>in next epoch&apos;s set</Pill>}
        </div>
      )}
      {p && !p.eligible && <p className="text-sm text-danger">Can&apos;t take stake: {p.refusals.map(refusalText).join(", ")}.</p>}
    </div>
  );
}

function LiquidPicker({ preset, onPick }: { preset: LiquidPreset; onPick: (p: LiquidPreset) => void }) {
  const { demo } = useApp();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {LIQUID_OPTIONS.map((o) => (
        <LiquidOption key={o.id} id={o.id} picked={preset === o.id} onPick={() => onPick(o.id)} demo={demo} />
      ))}
      <p className="text-xs text-muted sm:col-span-2">
        Minted with one signature after delivery (deposit_and_stake on the token contract, pinned by account and code hash). Tokens are never sent to these contracts by
        transfer: they have no ft_on_transfer.
      </p>
    </div>
  );
}

function LiquidOption({ id, picked, onPick, demo }: { id: LiquidPreset; picked: boolean; onPick: () => void; demo: ReturnType<typeof useApp>["demo"] }) {
  const o = LIQUID_OPTIONS.find((x) => x.id === id)!;
  const ls = useMemo(() => liquidStaking(demo, id), [demo, id]);
  const info = useAsync(() => Promise.all([ls.getPoolInfo(), ls.getApr().catch(() => null)]), [ls]);
  return (
    <button type="button" aria-pressed={picked} onClick={onPick} className={`flex flex-col gap-1 rounded-2xl border p-4 text-left transition ${picked ? "border-liquid/70 bg-liquid/10" : "border-line bg-surface hover:border-muted/60"}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium">{o.label}</span>
        {id === "rnear" && <Pill tone="liquid">Rhea</Pill>}
      </span>
      <span className="text-xs text-muted">{o.contract}</span>
      <span className="text-sm">
        {info.data ? (
          <>
            <span className="text-accent">{percent(info.data[1])} APR</span> · 1 {o.symbol} = {formatUnits(info.data[0].price, 24, 4)} NEAR
            {info.data[0].paused && <span className="text-danger"> · paused</span>}
          </>
        ) : info.error ? (
          <span className="text-muted">unavailable</span>
        ) : (
          <Spinner />
        )}
      </span>
    </button>
  );
}

function InstantCard({ recipient }: { recipient: string | null }) {
  const el = useAsync(() => (recipient ? instantStNearEligible(recipient) : Promise.resolve({ ok: false, reason: "Connect a NEAR wallet." })), [recipient]);
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-sm">
      <p className="font-medium">Meta Pool stNEAR, delivered straight by 1Click</p>
      <p className="text-muted">
        No NEAR signature at all. It costs more than staking yourself: the quote shows exactly how much stNEAR arrives, so compare it with a NEAR quote for the same amount.
        Instant unstake later uses Meta Pool&apos;s own live discount.
      </p>
      {el.loading ? <Spinner /> : el.data?.ok ? <Pill tone="accent">{recipient} can receive stNEAR</Pill> : <p className="text-warn">{el.data?.reason ?? el.error} Pick a validator pool or rNEAR instead.</p>}
    </div>
  );
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
}) {
  const { dryRun } = useApp();
  const res = quote.res;
  const isDry = quote.req.dry;
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

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel className="flex flex-col gap-5 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{stage === "review" ? "Your quote" : instant ? "Instant stNEAR" : `Staking into ${targetLabel(target)}`}</h2>
            <p className="text-sm text-muted">
              {isDry ? "Dry-run quote from 1Click: real prices, no deposit address." : "Live quote: the deposit address is yours for this swap only."}
            </p>
          </div>
          <button type="button" onClick={onRestart} className="btn-tactile shrink-0 px-3 py-1.5 text-sm font-medium">
            New quote
          </button>
        </div>

        <Rows>
          <Row label="You send">
            {formatUnits(BigInt(res.quote.amountIn), asset.decimals)} {asset.symbol}
            {res.quote.amountInUsd && <span className="block text-xs text-muted">≈ {money(Number(res.quote.amountInUsd))} on {asset.chainLabel}</span>}
          </Row>
          <Row label={instant ? "stNEAR delivered" : "NEAR delivered"} hint="to your NEAR account">
            ≈ {formatUnits(out, outDecimals, 5)} {instant ? "stNEAR" : "NEAR"}
            <span className="block text-xs text-muted">at least {formatUnits(BigInt(res.quote.minAmountOut), outDecimals, 5)}</span>
          </Row>
          {!instant && (
            <Row label="Then staked" hint="one signature after delivery">
              exactly what arrives, minus gas if the account is new
              <span className="block text-xs text-muted">into {targetLabel(target)} · about 0.05 NEAR stays so you can unstake later</span>
            </Row>
          )}
          <Row label="Fees">
            1Click {(appFee / 100).toFixed(2)} %{res.quote.withdrawFee && res.quote.withdrawFee !== "0" ? ` · delivery ${formatNear(BigInt(res.quote.withdrawFee), 5)}` : ""}
            {refundFee !== null && (
              <span className="block text-xs text-muted">
                a refund would cost {formatUnits(refundFee, asset.decimals)} {asset.symbol}
              </span>
            )}
          </Row>
          <Row label="Time">
            ~{duration(res.quote.timeEstimate * 1000)} after your deposit confirms
            <span className="block text-xs text-muted">{instant ? "no unbonding to stake" : target.kind === "native" ? "unstaking later: ~21–28 h" : "unstaking later: 4–5+ epochs (≈ 21–35 h+)"}</span>
          </Row>
          <Row label="Quote check">
            <span className="text-accent">✓ echo matches what you approved</span>
            <span className="block text-xs text-muted">recipient {shortAccount(quote.req.recipient)} · refund {shortAccount(quote.req.refundTo)} · {quote.req.destinationAsset} · {quote.req.recipientType}</span>
            <span className="block text-xs text-muted">signed quote saved in Recent activity</span>
          </Row>
        </Rows>

        {stage === "review" && (
          <>
            <ExchangeWarnings asset={asset} memo={res.quote.depositMemo ?? null} />
            {isDry ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted">Replay what happens next with statuses shaped like real 1Click answers (marked simulated):</p>
                <div className="flex flex-wrap gap-2">
                  {SIM_OUTCOMES.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => {
                        setSim({ outcome: o.id, step: 0, startedAt: Date.now() });
                        setStake("none");
                        setStage("track");
                      }}
                      className={o.id === "success" ? "btn-tactile-accent px-4 py-2.5 text-sm" : "btn-tactile px-4 py-2.5 text-sm font-medium"}
                    >
                      {o.id === "success" ? "Simulate: delivered" : o.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setStage("track")} className="btn-tactile-accent btn-tactile-lg justify-center px-6 py-3.5 text-base">
                Continue to deposit
              </button>
            )}
          </>
        )}

        {stage === "track" && (
          <>
            {sim && <Pill tone="warn" className="self-start">Simulated statuses · dry run</Pill>}
            <FundsRoute
              view={view}
              icons={{
                source: <img src={asset.icon} alt="" className="size-9 rounded-full" />,
                intents: <IntentsGlyph />,
                near: <img src={NEAR_ICON} alt="" className="size-9 rounded-full" />,
                pool: <LogoMark size={22} arc={false} />,
              }}
              extra={{
                source: (
                  <>
                    {depositTxHashes(status).map((h) => (
                      <TxLink key={h} chain={asset.chain} hash={h} className="text-xs" />
                    ))}
                  </>
                ),
                near: deliveryTxHash(status) ? <TxLink chain="near:mainnet" hash={deliveryTxHash(status)!} className="text-xs" /> : null,
              }}
            />
            {!isDry && phase === "awaiting-deposit" && !paidAt && (
              <DepositPanel
                quote={res}
                dryRun={dryRun}
                asset={asset}
                payer={payer && payer.family === asset.family ? payer : null}
                connecting={connectingPayer}
                onConnectPayer={onConnectPayer}
                cutoffMs={cutoff}
                onPaid={(hash) => {
                  const at = Date.now();
                  setPaidAt(at);
                  updateFlow(quote.flowId, { paidAt: at, addTx: { chain: asset.chain, hash, label: "Deposit" } });
                  void submitDepositTx({ txHash: hash, depositAddress: res.quote.depositAddress!, memo: res.quote.depositMemo });
                }}
              />
            )}
            {!isDry && phase === "awaiting-deposit" && paidAt && (
              <Banner tone="accent" title="Payment sent: waiting for 1Click to see it">
                Your wallet sent the deposit {ago(paidAt)}. Don&apos;t pay again: the status above moves on once 1Click indexes it (a few minutes on slow chains).
                <button
                  type="button"
                  onClick={() => {
                    setPaidAt(null);
                    updateFlow(quote.flowId, { paidAt: null });
                  }}
                  className="mt-2 block text-xs text-muted underline"
                >
                  The payment failed in my wallet: show the deposit again
                </button>
              </Banner>
            )}
            {phase === "unknown" && (
              <Banner tone="warn" title={status ? `1Click says ${status.status}` : "Checking the swap status"}>
                {status
                  ? "This app doesn't know that status, so nothing is offered to pay or stake. The signed quote is in Recent activity (Portfolio); 1Click support can look it up by the deposit address."
                  : "Asking 1Click where this swap is. Nothing can be paid or staked until it answers."}
              </Banner>
            )}
            {phase === "incomplete-deposit" && <TopUp res={res} status={status} asset={asset} refundTo={quote.req.refundTo} left={left} />}
            {phase === "refunded" && (
              <Banner tone="danger" title="Refunded">
                {status?.swapDetails.refundedAmount
                  ? `${formatUnits(BigInt(status.swapDetails.refundedAmount), asset.decimals)} ${asset.symbol} went back to ${shortAccount(quote.req.refundTo)}${status.swapDetails.refundReason ? ` (${status.swapDetails.refundReason})` : ""}.`
                  : `The deposit went back to ${shortAccount(quote.req.refundTo)} on ${asset.chainLabel}, minus the refund fee.`}{" "}
                Nothing reached NEAR, so there is nothing to unstake.
              </Banner>
            )}
            {phase === "failed" && (
              <Banner tone="danger" title="1Click reports the swap failed">
                Check {shortAccount(quote.req.refundTo)} on {asset.chainLabel} for a refund. If nothing arrives, contact 1Click support with the deposit address{" "}
                <span className="break-all font-mono text-xs">{res.quote.depositAddress}</span>; the signed quote is saved in Recent activity.
              </Banner>
            )}
            {phase === "expired" && (
              <Banner tone="danger" title="Deadline passed">
                No full deposit arrived in time. Anything sent goes back to {shortAccount(quote.req.refundTo)} on {asset.chainLabel}, minus the refund fee. This page keeps asking 1Click
                once a minute in case it saw a deposit late.
              </Banner>
            )}
            {!instant && phase === "delivered" && stakeState === "done" && record?.staked && (
              <Banner tone="accent" title="Already staked">
                {formatNear(BigInt(record.staked))} of this delivery is staked in {targetLabel(target)}. See it in Portfolio.
              </Banner>
            )}
            {!instant && phase === "delivered" && !(stakeState === "done" && record?.staked) && (
              <StakeStep target={target} recipient={recipient} status={status} simulated={!!sim} flowId={quote.flowId} attemptedAt={record?.stakeAttemptAt ?? null} stake={stake} setStake={setStake} />
            )}
          </>
        )}
      </Panel>
      <aside className="flex flex-col gap-3">
        {left !== null && !isTerminal(phase) && phase !== "processing" && phase !== "unknown" && (
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">Deposit deadline</p>
            <p className={`font-mono text-2xl tabular-nums ${left < cutoff ? "text-danger" : ""}`}>{left > 0 ? clock(left) : "passed"}</p>
            <p className="text-xs text-muted">
              The refund begins then: a deposit after it is refunded (minus the refund fee). Paying stops {Math.round(cutoff / 60_000)} min before it.
              {inactiveAt !== null && inactiveAt > (deadline ?? 0) ? ` The address goes inactive later, at ${dateTime(inactiveAt)}: never send to it after that.` : ""}
            </p>
          </div>
        )}
        <Facts />
      </aside>
    </div>
  );
}

function ExchangeWarnings({ asset, memo }: { asset: SourceAsset; memo: string | null }) {
  return (
    <details className="rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium text-warn">Sending from an exchange?</summary>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted">
        <li>The refund address must be your own wallet: a refund sent to an exchange deposit address can be lost.</li>
        <li>Exchanges often subtract their withdrawal fee. Less than the quoted amount arrives and the swap waits for a top-up (INCOMPLETE_DEPOSIT) or is refunded at the deadline.</li>
        {(memo || MEMO_CHAINS.has(asset.chain)) && <li>{asset.chainLabel} deposits may need a memo, and many exchanges can&apos;t add one.</li>}
        {KNOWN_MINIMUM_USD[asset.chain] && <li>{asset.chainLabel} currently has a ${KNOWN_MINIMUM_USD[asset.chain]} minimum per swap.</li>}
        <li>Refunds cost the refund fee shown above.</li>
      </ul>
    </details>
  );
}

/**
 * Less than quoted arrived. 1Click's docs say only that an EXACT_INPUT deposit below amountIn is
 * refunded by the deadline, so no top-up is suggested: the user waits for the refund and quotes again.
 */
function TopUp({ res, status, asset, refundTo, left }: { res: QuoteResponse; status: StatusResponse | null; asset: SourceAsset; refundTo: string; left: number | null }) {
  const got = status?.swapDetails.depositedAmount ? BigInt(status.swapDetails.depositedAmount) : 0n;
  return (
    <Banner tone="warn" title="Less than quoted arrived">
      {formatUnits(got, asset.decimals)} {asset.symbol} arrived of {formatUnits(BigInt(res.quote.amountIn), asset.decimals)} (an exchange may have taken its fee). 1Click refunds it to{" "}
      {shortAccount(refundTo)} at the deadline{left !== null && left > 0 ? `, in ${clock(left)}` : ""}, minus the refund fee. Then start a new quote and send the exact amount from a
      wallet.
    </Banner>
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
  flowId,
  attemptedAt,
  stake,
  setStake,
}: {
  target: Target;
  recipient: string;
  status: StatusResponse | null;
  simulated: boolean;
  flowId: string;
  /** A stake was signed for this delivery earlier and its result was never confirmed (from History). */
  attemptedAt: number | null;
  stake: "none" | "ready" | "signing" | "done" | "failed";
  setStake: (s: "none" | "ready" | "signing" | "done" | "failed") => void;
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

  // exactly what was delivered, capped by what the account can spend now (critique #2); read fresh for every preflight
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

  if (stake === "done")
    return (
      <Banner tone="accent" title="Staked">
        {formatNear(staked ?? amount?.amount ?? 0n)} is staked in {targetLabel(target)}. {hash && <TxLink chain="near:mainnet" hash={hash} />} See it in Portfolio.
      </Banner>
    );

  const blocked = unconfirmed !== null && !checkedNotStaked;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent/5 p-4">
      <p className="font-medium">Stake what arrived</p>
      {amount ? (
        <Rows>
          <Row label="Delivered" hint={amount.basis === "on-chain" ? "read from the NEAR transaction" : "as 1Click reports it"}>
            {reportedDelivery(status) !== null ? formatNear(reportedDelivery(status)!, 5) : "—"}
            {amount.mismatch && <span className="block text-xs text-warn">the NEAR transaction and 1Click differ: the lower figure is staked</span>}
          </Row>
          <Row label="Will stake" hint={amount.capped ? "capped by what the account can spend" : "exactly the delivery"}>
            <span className="font-semibold text-accent">{amount.tooSmall ? "too small to stake" : formatNear(amount.amount, 5)}</span>
          </Row>
        </Rows>
      ) : amountErr ? (
        <p className="text-sm text-danger">{amountErr}</p>
      ) : (
        <Spinner />
      )}
      {preflight && (
        <>
          <TxPreview transactions={preflight.transactions} />
          <p className="text-xs text-muted">
            Network fee at most {formatNear(preflight.fee, 5)} · {formatNear(preflight.upfront, 4)} held back for gas while it runs (refunded) · {formatNear(preflight.reserve, 4)} stays
            on the account for the unstake{preflight.apr !== null ? ` · APR ${percent(preflight.apr)}` : ""}
          </p>
          {preflight.warnings.map((w) => (
            <p key={w.code} className="text-sm text-warn">
              {w.message}
            </p>
          ))}
        </>
      )}
      {unconfirmed !== null && (
        <Banner tone="warn" title="A stake may already have gone through">
          A stake for this delivery was signed {ago(unconfirmed)} and its result wasn&apos;t confirmed. Check Portfolio first: signing again would stake other NEAR on the account.
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={checkedNotStaked} onChange={(e) => setCheckedNotStaked(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
            <span>I checked Portfolio: this delivery is not staked.</span>
          </label>
        </Banner>
      )}
      {err && <Banner tone={simulated ? "warn" : "danger"} title={simulated ? "Preflight on the demo account" : stake === "signing" ? "Wallet error" : "Preflight refused"}>{err}{simulated ? " In a live run the delivery itself funds the stake." : ""}</Banner>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void runPreflight()} disabled={busy || stake === "signing"} className="btn-tactile px-4 py-2.5 text-sm font-medium">
          {busy ? "Checking…" : "Preflight again"}
        </button>
        <button type="button" onClick={() => void sign()} disabled={!signing || !preflight || stake === "signing" || busy || blocked} className="btn-tactile-accent px-4 py-2.5 text-sm" title={signing ? undefined : "Dry run / demo account: nothing to sign"}>
          {stake === "signing" ? "Confirm in your wallet…" : "Sign and stake"}
        </button>
      </div>
      <p className="text-xs text-muted">
        Preflight runs the module&apos;s quote: the delivered amount, pool code, pause, fee, validator set and balances are read fresh, and the exact transaction is shown. NEAR has no
        transaction simulation, so nothing is executed until you sign; the signed transaction must equal this preview.
      </p>
    </div>
  );
}

export type { NearPoolInfo };
