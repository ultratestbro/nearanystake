import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-line bg-surface p-5 sm:p-6 ${className}`}>{children}</div>;
}

/** The main surface: one rounded panel the page sits in. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[28px] bg-panel ${className}`}>{children}</div>;
}

export type Tone = "muted" | "accent" | "danger" | "warn" | "liquid";

export function Pill({ children, tone = "muted", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  const c =
    tone === "accent"
      ? "border-accent/40 text-accent"
      : tone === "danger"
        ? "border-danger/40 text-danger"
        : tone === "warn"
          ? "border-warn/40 text-warn"
          : tone === "liquid"
            ? "border-liquid/40 text-liquid"
            : "border-line text-muted";
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ${c} ${className}`}>{children}</span>;
}

/** A sentence that needs attention: info, warning or error. */
export function Banner({ tone = "muted", title, children, className = "" }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const c =
    tone === "danger" ? "border-danger/40 bg-danger/10" : tone === "warn" ? "border-warn/40 bg-warn/10" : tone === "accent" ? "border-accent/40 bg-accent/10" : "border-line bg-surface-2/60";
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={`rounded-2xl border px-4 py-3 text-sm ${c} ${className}`}>
      {title && <p className={`font-medium ${tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent" : "text-text"}`}>{title}</p>}
      {children && <div className={`${title ? "mt-1" : ""} text-muted [&_b]:text-text`}>{children}</div>}
    </div>
  );
}

/** A label over a big number. */
export function Stat({ label, value, hint, className = "" }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-surface px-4 py-3 ${className}`}>
      <span className="truncate text-xs text-muted">{label}</span>
      <span className="truncate text-xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="truncate text-xs text-muted">{hint}</span>}
    </div>
  );
}

/** label · value rows inside a bordered list. */
export function Rows({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <dl className={`flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line text-sm ${className}`}>{children}</dl>;
}

export function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-muted">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </dt>
      <dd className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span aria-label="loading" className={`inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent ${className}`} />;
}

/** Tabs as tactile buttons; the active one turns into the light pill. */
export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: { id: T; label: ReactNode; dot?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  // pb-0.5 leaves room for a pressed tab to sink inside the scroller
  return (
    <div role="tablist" className={`no-scrollbar flex gap-2 overflow-x-auto pb-0.5 ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className="btn-tactile relative shrink-0 gap-1.5 px-4 py-2 text-sm font-medium"
        >
          {t.label}
          {t.dot && <span aria-label="needs attention" className="size-1.5 rounded-full bg-amber-400" />}
        </button>
      ))}
    </div>
  );
}

/** A list card: rows separated by hairlines. */
export function ListCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface ${className}`}>{children}</div>;
}

/** One list row: icon, label over a hint, a value on the right, a chevron when it opens something. */
export function ListRow({
  icon,
  label,
  hint,
  value,
  onClick,
  chevron = !!onClick,
  className = "",
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate">{label}</span>
        {hint && <span className="truncate text-xs text-muted">{hint}</span>}
      </span>
      {value !== undefined && <span className="shrink-0 text-right text-sm">{value}</span>}
      {chevron && <Chevron />}
    </>
  );
  const cls = `flex w-full items-center gap-3 px-4 py-3.5 ${className}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} transition hover:bg-surface-2`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Chevron({ dir = "right" }: { dir?: "right" | "left" | "down" }) {
  const d = dir === "left" ? "M10 3 5 8l5 5" : dir === "down" ? "M3 6l5 5 5-5" : "M6 3l5 5-5 5";
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-muted">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A grey placeholder block that pulses while data loads; size it with classes. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-lg bg-surface-2 ${className}`} />;
}

export function Progress({ pct, className = "" }: { pct: number; className?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-surface-2 ${className}`}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(pct > 0 ? 1.5 : 0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/** Chain / token icon from the SDK catalog; a lettered disc when there is none. */
export function Icon({ src, alt, size = 20 }: { src?: string | null; alt: string; size?: number }) {
  if (!src)
    return (
      <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] text-muted">
        {alt.slice(0, 1)}
      </span>
    );
  return <img src={src} alt={alt} width={size} height={size} loading="lazy" className="shrink-0 rounded-full bg-surface-2" />;
}
