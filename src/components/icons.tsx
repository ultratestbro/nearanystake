// Stroke icons drawn on a 24-unit grid with round caps and joins, so they match each other at any size.
// Every icon is decorative (aria-hidden): the button or text next to it carries the meaning, so an
// icon-only button still needs its own aria-label. Props: `size` in px (default 16), `className`
// (colour comes from currentColor, e.g. "text-muted").

import type { ReactNode } from "react";

export interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 16, className = "", width = 2, children }: IconProps & { width?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p} width={2.5}>
      <path d="M5 12.5 10 17 19 7" />
    </Svg>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Svg>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

/** Opens somewhere else (explorer links). */
export function ArrowUpRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 17 17 7M8 7h9v9" />
    </Svg>
  );
}

export function ArrowRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

export function ArrowDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </Svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p} width={2.25}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}

/** The single trust mark for a pool ("Verified"). */
export function ShieldCheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}
