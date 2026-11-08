"use client";

// Disclosure: a "Details" row that opens to show more (quote details, a signed quote, the steps of an
// activity row). A real button with aria-expanded / aria-controls; the content stays mounted while
// closed (hidden), so inputs inside keep their state.
//
//   <Disclosure summary="Details" hint="Fee < $0.01 · about 35 s">…rows…</Disclosure>
//   <Disclosure variant="plain" summary="Signed quote (keep for disputes)"><pre>…</pre></Disclosure>
//
// Props:
//   summary        the always-visible label.
//   hint           muted text after the label, e.g. the one number people look for. Optional.
//   children       what opens.
//   defaultOpen    starts open (uncontrolled). Default false.
//   open / onOpenChange   controlled mode, e.g. to force it open when something inside needs attention.
//   variant        "card" (bordered box, the default) | "plain" (a quiet text toggle, no box).
//   className      on the outer element; bodyClassName on the content wrapper.

import { useId, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "./icons";

export function Disclosure({
  summary,
  hint,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  variant = "card",
  className = "",
  bodyClassName = "",
}: {
  summary: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: "card" | "plain";
  className?: string;
  bodyClassName?: string;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;
  const id = useId();
  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setInner(next);
    onOpenChange?.(next);
  };
  const chevron = <ChevronDownIcon className={`text-muted motion-safe:transition-transform ${isOpen ? "rotate-180" : ""}`} />;

  if (variant === "plain")
    return (
      <div className={className}>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={id}
          onClick={toggle}
          className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-lg text-left text-sm text-muted hover:text-text"
        >
          <span className="min-w-0">{summary}</span>
          {hint && <span className="min-w-0 truncate">{hint}</span>}
          {chevron}
        </button>
        <div id={id} hidden={!isOpen} className={bodyClassName}>
          {children}
        </div>
      </div>
    );

  return (
    <div className={`rounded-2xl border border-line ${className}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={toggle}
        className="flex min-h-12 w-full items-center gap-2 rounded-2xl px-4 py-2 text-left hover:bg-surface/60"
      >
        <span className="shrink-0 text-sm font-medium">{summary}</span>
        {hint && <span className="min-w-0 truncate text-[13px] text-muted">{hint}</span>}
        <span className="ml-auto">{chevron}</span>
      </button>
      <div id={id} hidden={!isOpen} className={`px-4 pb-3 ${bodyClassName}`}>
        {children}
      </div>
    </div>
  );
}
