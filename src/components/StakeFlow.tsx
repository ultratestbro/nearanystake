"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KNOWN_MINIMUM_USD, MEMO_CHAINS, NEAR_ICON, PINNED_CHAINS, SOURCE_ASSETS, findAsset, looksLikeAddress, type SourceAsset } from "@/lib/assets";
import { addRecord, getFlow, newId, updateFlow, type FlowRecord } from "@/lib/history";
import { DEMO_ACCOUNT, SUGGESTED_POOL } from "@/lib/near/config";
import { checkRecipient, deliveredOnChain, instantStNearEligible } from "@/lib/near/reads";
import { getStatus, listTokens, requestQuote, submitDepositTx } from "@/lib/oneclick/client";
import { buildInboundQuoteRequest, quoteDeadline } from "@/lib/oneclick/quote";
import { SIM_OUTCOMES, simulatedStatuses, type SimOutcome } from "@/lib/oneclick/simulate";
import { deliveryTxHash, depositTxHashes, fundsView, isTerminal, phaseOf, reportedDelivery, type Phase } from "@/lib/oneclick/status";
import type { QuoteRequest, QuoteResponse, StatusResponse } from "@/lib/oneclick/types";
import { connectPayer, PAYER_LABEL, type Payer } from "@/lib/pay";
import { clock, duration, formatNear, formatUnits, money, parseUnits, percent, shortAccount } from "@/lib/format";
import { stakeAmountAfterDelivery } from "@/lib/stakeAmount";
import {
  DEFAULT_RESERVE, LIQUID_OPTIONS, MIN_STAKE, liquidStaking, nativeStaking, poolStatus, refusalText, stakingErrorText,
  type LiquidPreset, type LiquidStakeQuote, type NearPoolInfo, type NearStakeQuote,
} from "@/lib/staking";
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

/**
 * Dry quotes still need a refund address 1Click accepts; these are burn / precompile addresses nobody
 * controls (1Click refuses 0x…dEaD and Solana's system program). Used only when dry and left empty.
 */
const DRY_REFUND: Record<string, string> = {
  evm: "0x0000000000000000000000000000000000000001",
  solana: "1nc1nerator11111111111111111111111111111111",
  tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  bitcoin: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
};

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
  // a flow reopened from History (?flow=…) resumes at its status; this component renders on the client only
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
      const req = buildInboundQuoteRequest({ target: target.kind === "stnear" ? "stnear" : "near", originAsset: asset.assetId, amount, recipient, refundTo: refund, dry: dryRun });
      const res = await requestQuote(req, { dryRun, direction: "inbound" });
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
              onChange={(e) => setRefundTo(e.target.value)}
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
            setAsset(t as SourceAsset);
            if (payer && payer.family !== (t as SourceAsset).family) setPayer(null);
            setRefundTo("");
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
      <p>An epoch is ~6.9 h. Native unstaking takes 4 epochs: about 21–28 h.</p>
      <p>rNEAR and LiNEAR unstake in 4–5+ epochs (≈ 21–35 h or more); the exact epoch shows after you unstake.</p>
      <p>0.02 NEAR stays on your account for gas. A brand-new implicit account is created by the delivery itself.</p>
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
      <p className="text-muted">No NEAR signature at all. It costs more: measured 0.6–0.75 % less than minting stNEAR yourself. Instant unstake later uses Meta Pool&apos;s own live discount.</p>
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
  const [stakeState, setStake] = useState<"none" | "ready" | "signing" | "done" | "failed">("none");
  const status = useMemo(() => {
    if (!sim) return liveStatus;
    const list = simulatedStatuses(res, sim.outcome);
    return list[Math.min(sim.step, list.length - 1)]!;
  }, [sim, res, liveStatus]);
  const deadline = isDry ? (sim?.outcome === "expired" ? sim.startedAt + 4000 : null) : quoteDeadline(res);
  const phase: Phase = phaseOf(status, { deadlineMs: deadline, now });
  const instant = target.kind === "stnear";
  const stake = phase === "delivered" && stakeState === "none" && !instant ? "ready" : stakeState;
  const out = BigInt(res.quote.amountOut);
  const outDecimals = 24;

  // live: poll 1Click every 5 s until the swap settles
  useEffect(() => {
    if (stage !== "track" || isDry || !res.quote.depositAddress || isTerminal(phase)) return;
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
    const t = setInterval(() => void tick(), 5000);
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
              <span className="block text-xs text-muted">into {targetLabel(target)} · 0.02 NEAR stays for gas</span>
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
            <span className="block text-xs text-muted">signed quote saved in History</span>
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
            {!isDry && phase === "awaiting-deposit" && (
              <DepositPanel
                quote={res}
                dryRun={dryRun}
                asset={asset}
                payer={payer && payer.family === asset.family ? payer : null}
                connecting={connectingPayer}
                onConnectPayer={onConnectPayer}
                onPaid={(hash) => {
                  updateFlow(quote.flowId, { addTx: { chain: asset.chain, hash, label: "Deposit" } });
                  void submitDepositTx({ txHash: hash, depositAddress: res.quote.depositAddress!, memo: res.quote.depositMemo });
                }}
              />
            )}
            {phase === "incomplete-deposit" && <TopUp res={res} status={status} asset={asset} left={left} />}
            {(phase === "refunded" || phase === "failed" || phase === "expired") && (
              <Banner tone="danger" title={phase === "expired" ? "Quote expired" : phase === "refunded" ? "Refunded" : "Swap failed"}>
                {phase === "refunded" && status?.swapDetails.refundedAmount
                  ? `${formatUnits(BigInt(status.swapDetails.refundedAmount), asset.decimals)} ${asset.symbol} went back to ${shortAccount(quote.req.refundTo)}${status.swapDetails.refundReason ? ` (${status.swapDetails.refundReason})` : ""}.`
                  : `Anything deposited goes back to ${shortAccount(quote.req.refundTo)} on ${asset.chainLabel}, minus the refund fee.`}{" "}
                Nothing reached NEAR, so there is nothing to unstake.
              </Banner>
            )}
            {!instant && phase === "delivered" && (
              <StakeStep target={target} recipient={recipient} status={status} simulated={!!sim} flowId={quote.flowId} stake={stake} setStake={setStake} />
            )}
          </>
        )}
      </Panel>
      <aside className="flex flex-col gap-3">
        {left !== null && !isTerminal(phase) && phase !== "processing" && (
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">Deposit deadline</p>
            <p className={`font-mono text-2xl tabular-nums ${left < 5 * 60_000 ? "text-danger" : ""}`}>{left > 0 ? clock(left) : "passed"}</p>
            <p className="text-xs text-muted">A deposit after it is refunded (minus the refund fee).</p>
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

function TopUp({ res, status, asset, left }: { res: QuoteResponse; status: StatusResponse | null; asset: SourceAsset; left: number | null }) {
  const got = status?.swapDetails.depositedAmount ? BigInt(status.swapDetails.depositedAmount) : 0n;
  const need = BigInt(res.quote.amountIn) - got;
  return (
    <Banner tone="warn" title="Top up the difference">
      {formatUnits(got, asset.decimals)} {asset.symbol} arrived of {formatUnits(BigInt(res.quote.amountIn), asset.decimals)}. Send{" "}
      <b>
        {formatUnits(need > 0n ? need : 0n, asset.decimals)} {asset.symbol}
      </b>{" "}
      more to the same deposit address{left !== null && left > 0 ? ` within ${clock(left)}` : ""}, or let it be refunded at the deadline.
    </Banner>
  );
}

function StakeStep({
  target,
  recipient,
  status,
  simulated,
  flowId,
  stake,
  setStake,
}: {
  target: Target;
  recipient: string;
  status: StatusResponse | null;
  simulated: boolean;
  flowId: string;
  stake: "none" | "ready" | "signing" | "done" | "failed";
  setStake: (s: "none" | "ready" | "signing" | "done" | "failed") => void;
}) {
  const { near, demo } = useApp();
  const signing = !!near && near.accountId === recipient && !simulated;
  const account = signing ? near!.account : demo;
  const native = useMemo(() => nativeStaking(account), [account]);
  const liquid = useMemo(() => (target.kind === "liquid" ? liquidStaking(account, target.preset) : null), [account, target]);
  const [preflight, setPreflight] = useState<NearStakeQuote | LiquidStakeQuote | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const once = useRef(false);

  // exactly what was delivered, capped by what the account can spend (critique #2)
  const amount = useAsync(async () => {
    const reported = reportedDelivery(status);
    const delivery = deliveryTxHash(status);
    const onChain = !simulated && delivery ? await deliveredOnChain(delivery, recipient) : null;
    // a simulated delivery never reached the account: assume a new account paying reserve and gas from it
    const maxStakeable = simulated ? (reported ?? 0n) - DEFAULT_RESERVE - 5n * 10n ** 21n : liquid ? await liquid.getMaxStakeable() : await native.getMaxStakeable();
    return stakeAmountAfterDelivery({ reported, onChain, maxStakeable, minStake: MIN_STAKE });
  }, [status, simulated, recipient, native, liquid]);

  const runPreflight = useCallback(async () => {
    if (!amount.data || amount.data.tooSmall) return;
    setErr("");
    setBusy(true);
    try {
      const q = liquid ? await liquid.quoteStake({ amount: amount.data.amount }) : await native.quoteStake({ amount: amount.data.amount, pool: (target as { pool: string }).pool });
      setPreflight(q);
    } catch (e) {
      setPreflight(null);
      setErr(stakingErrorText(e));
    } finally {
      setBusy(false);
    }
  }, [amount.data, liquid, native, target]);

  useEffect(() => {
    if (amount.data && !once.current) {
      once.current = true;
      void runPreflight();
    }
  }, [amount.data, runPreflight]);

  const sign = async () => {
    if (!preflight || !amount.data) return;
    setErr("");
    setStake("signing");
    try {
      const r = liquid
        ? await liquid.stake({ amount: amount.data.amount, expected: preflight.transactions })
        : await native.stake({ amount: amount.data.amount, pool: (target as { pool: string }).pool, expected: preflight.transactions });
      setHash(r.hash);
      updateFlow(flowId, { staked: amount.data.amount.toString(), addTx: { chain: "near:mainnet", hash: r.hash, label: "Stake" } });
      setStake("done");
    } catch (e) {
      setErr(stakingErrorText(e));
      setStake("failed");
    }
  };

  if (stake === "done")
    return (
      <Banner tone="accent" title="Staked">
        {amount.data && formatNear(amount.data.amount)} is staked in {targetLabel(target)}. {hash && <TxLink chain="near:mainnet" hash={hash} />} See it under Positions.
      </Banner>
    );

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent/5 p-4">
      <p className="font-medium">Stake what arrived</p>
      {amount.data ? (
        <Rows>
          <Row label="Delivered" hint={amount.data.basis === "on-chain" ? "read from the NEAR transaction" : "as 1Click reports it"}>
            {reportedDelivery(status) !== null ? formatNear(reportedDelivery(status)!, 5) : "—"}
          </Row>
          <Row label="Will stake" hint={amount.data.capped ? "capped by what the account can spend" : "exactly the delivery"}>
            <span className="font-semibold text-accent">{amount.data.tooSmall ? "too small to stake" : formatNear(amount.data.amount, 5)}</span>
          </Row>
        </Rows>
      ) : amount.error ? (
        <p className="text-sm text-danger">{amount.error}</p>
      ) : (
        <Spinner />
      )}
      {preflight && (
        <>
          <TxPreview transactions={preflight.transactions} />
          <p className="text-xs text-muted">
            Network fee at most {formatNear(preflight.fee, 5)} (unused gas is refunded){preflight.apr !== null ? ` · APR ${percent(preflight.apr)}` : ""}
          </p>
          {preflight.warnings.map((w) => (
            <p key={w.code} className="text-sm text-warn">
              {w.message}
            </p>
          ))}
        </>
      )}
      {err && <Banner tone={simulated ? "warn" : "danger"} title={simulated ? "Preflight on the demo account" : "Preflight refused"}>{err}{simulated ? " In a live run the delivery itself funds the stake." : ""}</Banner>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void runPreflight()} disabled={busy || !amount.data} className="btn-tactile px-4 py-2.5 text-sm font-medium">
          {busy ? "Checking…" : "Preflight again"}
        </button>
        <button type="button" onClick={() => void sign()} disabled={!signing || !preflight || stake === "signing"} className="btn-tactile-accent px-4 py-2.5 text-sm" title={signing ? undefined : "Dry run / demo account: nothing to sign"}>
          {stake === "signing" ? "Confirm in your wallet…" : "Sign and stake"}
        </button>
      </div>
      <p className="text-xs text-muted">
        Preflight runs the module&apos;s quote: pool code, pause, fee, validator set and balances are read fresh, and the exact transaction is shown. NEAR has no
        transaction simulation, so nothing is executed until you sign; the signed transaction must equal this preview.
      </p>
    </div>
  );
}

export type { NearPoolInfo };
