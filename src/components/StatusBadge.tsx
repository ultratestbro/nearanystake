// StatusBadge: one short state word with a colour cue, for flow steps, activity rows and positions
// ("Done", "In progress", "Your turn", "Refunded", "Staked, earning", "Verified").
//
//   <StatusBadge tone="success">Done</StatusBadge>
//   <StatusBadge tone="progress" pulse>In progress</StatusBadge>
//   <StatusBadge tone="success" icon={<ShieldCheckIcon size={14} />} title="Standard pool code, not paused, in the validator set">Verified</StatusBadge>
//
// Props:
//   tone     "success" (accent) | "progress" (amber, under way) | "attention" (amber, the user must act)
//            | "danger" (refunded, failed) | "liquid" (violet, liquid staking tokens) | "neutral" (muted). Default "neutral".
//   variant  "pill" (tinted background, the default) | "plain" (tone-coloured text, no background)
//            | "dot" (default text colour, only the dot carries the tone).
//   icon     replaces the leading dot (keep it 14 px; icons are aria-hidden).
//   pulse    the dot pulses (only when motion is allowed); for things that are moving right now.
//   title    hover text with the details behind the word. It is not reachable by touch or keyboard:
//            for details that matter, put an InfoHint next to the badge instead.
// Colour is never the only signal: the word itself says the state.

import type { ReactNode } from "react";

export type StatusTone = "success" | "progress" | "attention" | "danger" | "liquid" | "neutral";

const TEXT: Record<StatusTone, string> = {
  success: "text-accent",
  progress: "text-warn",
  attention: "text-warn",
  danger: "text-danger",
  liquid: "text-liquid",
  neutral: "text-muted",
};

const BG: Record<StatusTone, string> = {
  success: "bg-accent/12",
  progress: "bg-warn/14",
  attention: "bg-warn/14",
  danger: "bg-danger/14",
  liquid: "bg-liquid/14",
  neutral: "bg-surface",
};

const DOT: Record<StatusTone, string> = {
  success: "bg-accent",
  progress: "bg-warn",
  attention: "bg-warn",
  danger: "bg-danger",
  liquid: "bg-liquid",
  neutral: "bg-muted",
};

export function StatusBadge({
  tone = "neutral",
  variant = "pill",
  icon,
  pulse = false,
  title,
  className = "",
  children,
}: {
  tone?: StatusTone;
  variant?: "pill" | "plain" | "dot";
  icon?: ReactNode;
  pulse?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const shape =
    variant === "pill"
      ? `h-6 rounded-full px-2.5 text-xs font-semibold ${BG[tone]} ${TEXT[tone]}`
      : variant === "plain"
        ? `text-sm font-medium ${TEXT[tone]}`
        : "text-sm font-medium text-text";
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap ${shape} ${className}`}>
      {icon ?? <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[tone]} ${pulse ? "motion-safe:animate-pulse" : ""}`} />}
      {children}
    </span>
  );
}
