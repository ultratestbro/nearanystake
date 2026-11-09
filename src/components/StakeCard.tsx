"use client";

// Presentational pieces of the Stake card, laid out like a swap form: one card that reads
// You pay → You stake into → You get → Details → one primary action (side by side from lg: the
// inputs and Details left, You get and the action right), and turns into the tracker once money moves.
// No state here: StakeFlow owns it and passes data in.

import { useRef, type ReactNode } from "react";
import { SOURCE_ASSETS } from "@/lib/assets";
import { formatUnits } from "@/lib/format";
import { ChevronDownIcon } from "./icons";
import { InfoHint } from "./InfoHint";
import { Skeleton } from "./ui";

/** Chains a stake can be paid from (the catalog, NEAR itself excluded). */
export const SOURCE_CHAIN_COUNT = new Set(SOURCE_ASSETS.map((a) => a.chain)).size;

/** The big primary action and the quiet secondary one under it. */
export const CTA = "btn-tactile-accent min-h-14 w-full justify-center whitespace-normal px-6 py-3 text-center text-[17px] leading-6";
export const QUIET = "inline-flex min-h-11 items-center justify-center rounded-lg px-2 text-sm font-medium text-muted underline-offset-4 hover:text-text hover:underline";
/** A visible second choice under the primary (e.g. the dry-run quote when no wallet is connected). */
export const SECONDARY = "btn-tactile min-h-12 w-full justify-center whitespace-normal px-4 py-2 text-center text-[15px] font-medium";
/** A small outlined pill (quick amounts, other outcomes); the hit area reaches 44 px tall. Add the size. */
export const CHIP =
  "relative inline-flex items-center rounded-full border border-line font-medium text-muted transition-colors after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:border-muted hover:text-text";

/** NEAR with as many decimals as the size needs: 1.343, 0.4259, 12.35. */
export function nearAmount(yocto: bigint): string {
  const whole = yocto / 10n ** 24n;
  return formatUnits(yocto, 24, whole >= 100n ? 1 : whole >= 10n ? 2 : whole >= 1n ? 3 : 4);
}

export function StakeIntro() {
  return (
    <div className="mx-auto mb-4 max-w-[720px] text-center sm:mb-6">
      <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-balance sm:text-[32px] sm:leading-10">Stake NEAR with what you already hold</h1>
      <p className="mt-1 text-[15px] leading-6 text-pretty text-muted">Pay from any of {SOURCE_CHAIN_COUNT} chains. NEAR lands in your own account, then one signature stakes it.</p>
    </div>
  );
}

/**
 * The stake form's card: one column on phones and tablets, two from lg. Rows from lg: You pay | You get,
 * then You stake into | the action (which spans the rest), then Details under the inputs, then a
 * flexible row only the action reaches, so a tall action grows the card instead of the left rows.
 */
const FORM_CARD =
  "mx-auto w-full max-w-[520px] rounded-3xl border border-line bg-panel p-4 sm:p-5 lg:grid lg:max-w-[1040px] lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_auto_auto_1fr] lg:gap-x-6";
const AT = {
  pay: "flex min-w-0 flex-col lg:col-start-1 lg:row-start-1",
  into: "min-w-0 lg:col-start-1 lg:row-start-2",
  // stretched to the You pay box's height (the connector under that box matches this margin)
  summary: "mt-2 grid min-w-0 lg:col-start-2 lg:row-start-1 lg:mb-2 lg:mt-0",
  details: "mt-3 min-w-0 lg:col-start-1 lg:row-start-3",
  action: "mt-3 min-w-0 lg:col-start-2 lg:row-start-2 lg:row-span-3 lg:mt-0",
};

/** What the server sends before the flow (which reads the URL) renders in the browser: the form's shape. */
export function StakeFallback() {
  return (
    <>
      <StakeIntro />
      <div aria-busy="true" className={FORM_CARD}>
        {/* the heights of the no-wallet form, so nothing jumps when it mounts */}
        <div className={AT.pay}>
          <Skeleton className="h-[144px] w-full rounded-2xl" />
          <div className="h-2" />
        </div>
        <div className={AT.into}>
          <Skeleton className="h-[202px] w-full rounded-2xl sm:h-[200px]" />
        </div>
        <div className={AT.summary}>
          <Skeleton className="h-[141px] w-full rounded-2xl lg:h-full" />
        </div>
        <div className={AT.details}>
          <Skeleton className="h-[50px] w-full rounded-2xl" />
        </div>
        <div className={AT.action}>
          <Skeleton className="h-14 w-full rounded-[14px]" />
          <Skeleton className="mt-2 h-12 w-full rounded-[14px]" />
          <Skeleton className="mx-auto mt-2.5 h-6 w-44" />
        </div>
        <span className="sr-only">Loading the stake form…</span>
      </div>
    </>
  );
}

/**
 * The setup and quote card, in reading order: You pay → You stake into → You get → Details → the action.
 * Phones and tablets show that order in one column. From lg the inputs and Details make the left column
 * and You get with the action the right one, so opening Details (a refund address, the own-wallet
 * confirmation) never pushes the action down.
 */
export function FormCard({ label, pay, into, summary, details, action }: { label: string; pay: ReactNode; into: ReactNode; summary: ReactNode; details: ReactNode; action: ReactNode }) {
  return (
    <section aria-label={label} className={FORM_CARD}>
      <div className={AT.pay}>
        <div className="grid flex-1">{pay}</div>
        <Connector />
      </div>
      <div className={AT.into}>{into}</div>
      <div className={AT.summary}>{summary}</div>
      <div className={AT.details}>{details}</div>
      <div className={AT.action}>{action}</div>
    </section>
  );
}

/** The card itself: a heading row (title, a state on the right) and the content. */
export function CardShell({
  id,
  title,
  sub,
  right,
  heading = "h2",
  wide = false,
  children,
}: {
  id: string;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  heading?: "h1" | "h2";
  wide?: boolean;
  children: ReactNode;
}) {
  const H = heading;
  return (
    <section aria-labelledby={id} className={`mx-auto w-full rounded-3xl border border-line bg-panel p-4 sm:p-6 ${wide ? "max-w-[560px]" : "max-w-[520px]"}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <H id={id} className="text-xl font-semibold leading-7">
            {title}
          </H>
          {sub && <p className="text-sm text-muted">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/**
 * The one muted line under the action: the mode (dot + word), a few words on what follows, the rest in a
 * hint. Its top margin keeps the hint's 44 px hit area off the button above.
 */
export function ModeLine({ live, children, hint, hintLabel = "What happens next" }: { live: boolean; children: ReactNode; hint?: string; hintLabel?: string }) {
  return (
    <p className="mt-2.5 flex min-h-6 flex-wrap items-center justify-center gap-x-2 text-center text-[13px] leading-5 text-muted">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${live ? "bg-accent" : "bg-muted"}`} />
      <span className="text-pretty">{children}</span>
      {hint && (
        <InfoHint label={hintLabel} className="-ml-1.5">
          {hint}
        </InfoHint>
      )}
    </p>
  );
}

/** One of the card's inner panels (You pay, You stake into, You get). */
export function Box({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-surface p-4 ${className}`}>{children}</div>;
}

/** The arrow between You pay and You stake into. */
export function Connector() {
  return (
    <div aria-hidden className="relative z-[1] h-2">
      <span className="absolute left-1/2 top-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border-4 border-panel bg-surface text-muted">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      </span>
    </div>
  );
}

/**
 * Segmented single choice (Validator / rNEAR / LiNEAR) with its rate under or beside the name.
 * A radio group: one tab stop, arrow keys move the choice. `value` null = none of these (stNEAR).
 */
export function TargetChoice<T extends string>({
  labelledBy,
  value,
  options,
  onChange,
}: {
  labelledBy: string;
  value: T | null;
  options: { id: T; label: string; rate: ReactNode }[];
  onChange: (id: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = options.findIndex((o) => o.id === value);
  const move = (i: number) => {
    const n = (i + options.length) % options.length;
    onChange(options[n]!.id);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="mt-3 grid grid-cols-3 gap-1 rounded-[14px] border border-line bg-panel p-1">
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === (at >= 0 ? at : 0) ? 0 : -1}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i + 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i - 1);
              }
            }}
            className={`flex min-h-11 flex-col items-center justify-center rounded-[10px] px-1 py-1 text-sm leading-5 transition-colors sm:flex-row sm:gap-1.5 ${
              on ? "bg-pill font-semibold text-accent-ink" : "font-medium text-text hover:bg-surface"
            }`}
          >
            <span>{o.label}</span>
            <span className={`tabular-nums ${on ? "font-medium text-[#525252]" : "text-muted"}`}>{o.rate}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The chosen pool or token as one row: avatar, then the name with its single trust mark and a line of
 * numbers under it. With `onClick` the whole row opens the picker (the badge stays its own control on top).
 */
export function TargetRow({
  avatar,
  title,
  meta,
  badge,
  onClick,
  clickLabel,
}: {
  avatar: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  onClick?: () => void;
  clickLabel?: string;
}) {
  return (
    <div
      className={`relative mt-3 flex min-h-16 items-center gap-3 rounded-[14px] border border-line bg-panel px-3 py-2.5 ${
        onClick ? "shadow-[inset_0_-2px_0_rgb(0_0_0/0.35)] transition hover:brightness-110" : ""
      }`}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          {onClick ? (
            <button
              type="button"
              onClick={onClick}
              aria-label={clickLabel}
              className="min-w-0 truncate text-left text-base font-semibold leading-6 after:absolute after:inset-0 after:rounded-[14px] after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
            >
              {title}
            </button>
          ) : (
            <span className="min-w-0 truncate text-base font-semibold leading-6">{title}</span>
          )}
          {badge && <span className="relative z-10 inline-flex shrink-0">{badge}</span>}
        </div>
        {meta && <div className="text-[13px] leading-5 text-pretty text-muted max-sm:text-xs max-sm:leading-[18px]">{meta}</div>}
      </div>
      {onClick && <ChevronDownIcon className="pointer-events-none shrink-0 text-muted" />}
    </div>
  );
}

/** label · value rows inside Details; on phones the label sits above its value. */
export function DetailRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="inline-flex min-h-5 shrink-0 items-center gap-0.5 whitespace-nowrap text-muted">
        {label}
        {hint}
      </dt>
      <dd className="m-0 min-w-0 text-pretty [overflow-wrap:anywhere] sm:text-right">{children}</dd>
    </div>
  );
}

export type NoticeTone = "neutral" | "success" | "attention" | "danger";

/** A short notice in the card: refunded, deadline, less than quoted, payment sent… */
export function Notice({ tone = "neutral", title, icon, children, className = "" }: { tone?: NoticeTone; title?: ReactNode; icon?: ReactNode; children?: ReactNode; className?: string }) {
  const box = tone === "danger" ? "border-danger/40 bg-danger/10" : tone === "attention" ? "border-warn/40 bg-warn/10" : tone === "success" ? "border-accent/30 bg-accent/10" : "border-transparent bg-surface";
  const head = tone === "danger" ? "text-danger" : tone === "attention" ? "text-warn" : tone === "success" ? "text-accent" : "text-text";
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={`flex items-start gap-3 rounded-[14px] border px-4 py-3 text-sm leading-5 ${box} ${className}`}>
      {icon && <span className={`mt-0.5 shrink-0 ${head}`}>{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className={`font-semibold ${head}`}>{title}</p>}
        {children && <div className={`${title ? "mt-1" : ""} text-text/85 [overflow-wrap:anywhere]`}>{children}</div>}
      </div>
    </div>
  );
}

const STEP_ICONS = [
  <path key="a" d="M12 3c3.9 0 7 1.3 7 3s-3.1 3-7 3-7-1.3-7-3 3.1-3 7-3ZM5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />,
  <path key="b" d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  <path key="c" d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
];

/** Three short steps under the card; the details live in hints. */
export function HowItWorks({ eta }: { eta?: string | null }) {
  const steps: { t: string; d: string; hint?: { label: string; text: string } }[] = [
    { t: "1. Pay with what you hold", d: `Any token from ${SOURCE_CHAIN_COUNT} chains` },
    {
      t: "2. NEAR lands in your account",
      d: eta ? `NEAR Intents swaps it in about ${eta}` : "NEAR Intents swaps it into native NEAR",
    },
    {
      t: "3. Sign once to stake",
      d: "Stakes exactly what arrived",
      hint: { label: "What gets staked", text: "Only the NEAR this swap delivered is staked, never what was already on your account." },
    },
  ];
  return (
    <ol aria-label="How it works" className="mx-auto mt-6 grid max-w-[1040px] list-none gap-4 p-0 sm:mt-8 sm:grid-cols-3 sm:gap-6 lg:px-5">
      {steps.map((s, i) => (
        <li key={s.t} className="flex items-start gap-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-panel text-accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {STEP_ICONS[i]}
            </svg>
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] font-semibold leading-5">{s.t}</span>
            <span className="text-[13px] leading-5 text-muted">
              {s.d}
              {s.hint && (
                <>
                  {" "}
                  <InfoHint label={s.hint.label}>{s.hint.text}</InfoHint>
                </>
              )}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
