// Small pieces for showing a staking pool the same way on the Stake card and in the pool picker:
// its short name, a lettered avatar, a compact stake figure and the single trust mark.

import { formatUnits } from "@/lib/format";
import { poolStatus, refusalText, type NearPoolInfo } from "@/lib/staking";
import type { StatusTone } from "./StatusBadge";

/** "astro-stakers.poolv1.near" → "astro-stakers". */
export const poolName = (id: string) => id.replace(/\.(poolv1|pool)\.near$/, "");

/** Two letters for the avatar: "astro-stakers" → "AS", "figment" → "FI", "rNEAR" → "rN". */
export function initials(name: string): string {
  const parts = name.split(/[-_.\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  // pool ids are lowercase ("figment" → "FI"); token symbols keep their case ("rNEAR" → "rN")
  return name === name.toLowerCase() ? name.slice(0, 2).toUpperCase() : name.slice(0, 2);
}

/** Whole NEAR in a short form: 33,145,426 NEAR → "33.1 M". Bigint all the way. */
export function compactNear(yocto: bigint): string {
  const whole = yocto / 10n ** 24n;
  if (whole >= 1_000_000n) return `${formatUnits(whole / 100_000n, 1, 1)} M`;
  if (whole >= 10_000n) return `${formatUnits(whole / 100n, 1, 1)} K`;
  return formatUnits(whole, 0);
}

/** The lettered disc; `liquid` tints it violet (liquid staking tokens). */
export function PoolAvatar({ name, tone = "pool", size = 40, dashed = false }: { name: string; tone?: "pool" | "liquid" | "instant"; size?: number; dashed?: boolean }) {
  const c = tone === "liquid" ? "bg-liquid/15 text-liquid border-liquid/40" : tone === "instant" ? "bg-surface-2 text-text border-line" : "bg-surface text-text border-line";
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size >= 36 ? 13 : 11 }}
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${dashed ? "border-2 border-dashed border-warn" : `border ${c}`}`}
    >
      {initials(name)}
    </span>
  );
}

/** One trust mark for a pool instead of a row of pills: "Verified", or what keeps it from taking stake. */
export function poolBadge(p: NearPoolInfo): { label: string; tone: StatusTone; details: string } {
  const st = poolStatus(p);
  if (p.details && p.eligible) {
    const checks = [p.codeHashKnown && "standard pool code", p.paused === false && "not paused", p.inNextSet && "in the next epoch's validator set"].filter(Boolean);
    return { label: "Verified", tone: "success", details: `Checked live: ${checks.join(", ")}. Checked again before you sign.` };
  }
  const why = p.refusals.length ? `Can't take stake: ${p.refusals.map(refusalText).join(", ")}.` : "Details are read when you pick it.";
  return { label: st.label, tone: st.tone === "danger" ? "danger" : st.tone === "warn" ? "attention" : "neutral", details: why };
}
