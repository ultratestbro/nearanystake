// Display helpers. Amounts stay bigint end to end; only these functions turn them into text.

export const YOCTO_PER_NEAR = 10n ** 24n;

/** Base units → decimal text, at most `maxFrac` fraction digits, trailing zeros dropped. */
export function formatUnits(v: bigint, decimals: number, maxFrac = 6): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  const frac = (a % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

/** Same, without thousands separators (for inputs and copy buttons). */
export function plainUnits(v: bigint, decimals: number, maxFrac = decimals): string {
  return formatUnits(v, decimals, maxFrac).replace(/,/g, "");
}

/** "12.5" in a token with `decimals` → base units; null when it is not a plain positive decimal. */
export function parseUnits(text: string, decimals: number): bigint | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d*(\.\d*)?$/.test(t) || t === "" || t === ".") return null;
  const [w = "", f = ""] = t.split(".");
  if (f.length > decimals) return null;
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function formatNear(yocto: bigint, maxFrac = 4): string {
  return `${formatUnits(yocto, 24, maxFrac)} NEAR`;
}

/** "0x68771450d2…" → "0x6877…3f95". */
export function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

/** Readable names stay whole; implicit and 0x accounts are shortened. */
export function shortAccount(a: string): string {
  if (/^0x[0-9a-f]{9,}$/i.test(a)) return `${a.slice(0, 6)}…${a.slice(-4)}`;
  if (a.includes(".") && a.length <= 28) return a;
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function percent(v: number | null | undefined, frac = 2): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(frac)}%`;
}

export function money(usd: number, frac = 2): string {
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: frac })}`;
}

/** 75_600_000 → "21 h 0 min"; under an hour "12 min"; under a minute "45 s". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** mm:ss for short countdowns. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(1, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}
