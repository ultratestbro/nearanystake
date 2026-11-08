"use client";

// InfoHint: a small (i) button that shows a one- or two-sentence explanation, so long "good to know"
// text can leave the page. Opens on hover, on keyboard focus and on tap/click; Esc, a tap elsewhere or
// moving away closes it. The bubble is portalled to <body> with fixed positioning, so cards with
// overflow-hidden and modals do not clip it, and it is kept inside the viewport.
// Screen readers get the text as the button's description (a hidden copy), so keep `children` plain
// text (no links or buttons inside).
//
//   <InfoHint label="Why some NEAR stays on your account">A gas reserve so you can unstake later.</InfoHint>
//   <InfoHint label="Verified pool" trigger={<StatusBadge tone="success">Verified</StatusBadge>}>Standard pool code, not paused.</InfoHint>
//
// Props:
//   label     the accessible name of the (i) button ("About fees"). With `trigger` the trigger's own
//             text is the name and `label` is not used.
//   children  the explanation.
//   trigger   custom visible content instead of the (i) icon (e.g. a StatusBadge). Optional.
//   side      "top" (default) | "bottom": the preferred side; it flips when there is no room.
//   className on the trigger button.
// Never place it inside another button or link (nested controls); use a `title` there instead.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { InfoIcon } from "./icons";

const GAP = 8;
const EDGE = 8;

export function InfoHint({
  label,
  children,
  trigger,
  side = "top",
  className = "",
}: {
  label: string;
  children: ReactNode;
  trigger?: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const id = useId();

  const show = () => {
    if (leave.current) clearTimeout(leave.current);
    setOpen(true);
  };
  const hide = () => {
    pinned.current = false;
    setOpen(false);
  };
  // a short delay lets the pointer travel from the trigger onto the bubble (WCAG 1.4.13)
  const hideSoon = () => {
    if (pinned.current) return;
    if (leave.current) clearTimeout(leave.current);
    leave.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => void (leave.current && clearTimeout(leave.current)), []);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      pinned.current = false;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // closes the hint only, not a modal it sits in
      e.stopPropagation();
      close();
    };
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !bubble.current?.contains(t)) close();
    };
    document.addEventListener("keydown", esc, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", esc, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = button.current;
      const b = bubble.current;
      if (!t || !b) return;
      const r = t.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const above = r.top - b.offsetHeight - GAP;
      const below = r.bottom + GAP;
      const fitsAbove = above >= EDGE;
      const fitsBelow = below + b.offsetHeight <= vh - EDGE;
      const top = side === "top" ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
      const left = Math.max(EDGE, Math.min(r.left + r.width / 2 - b.offsetWidth / 2, vw - b.offsetWidth - EDGE));
      b.style.top = `${Math.max(EDGE, top)}px`;
      b.style.left = `${left}px`;
      b.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, side]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={trigger ? undefined : label}
        aria-describedby={id}
        onClick={() => {
          pinned.current = !(open && pinned.current);
          if (pinned.current) show();
          else hide();
        }}
        onPointerEnter={(e) => e.pointerType === "mouse" && show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && hideSoon()}
        // keyboard focus opens it; a tap focuses too, but the click handler owns that case
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && show()}
        onBlur={hide}
        className={
          trigger
            ? `inline-flex max-w-full cursor-help items-center rounded-full ${className}`
            : `relative inline-grid size-6 shrink-0 cursor-help place-items-center rounded-full align-middle text-muted hover:text-text after:absolute after:-inset-2 after:content-[''] ${className}`
        }
      >
        {trigger ?? <InfoIcon size={16} />}
      </button>
      {/* what assistive tech reads; the visible bubble below is a copy */}
      <span id={id} className="sr-only">
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={bubble}
            aria-hidden
            onPointerEnter={(e) => e.pointerType === "mouse" && show()}
            onPointerLeave={(e) => e.pointerType === "mouse" && hideSoon()}
            style={{ visibility: "hidden" }}
            className="fixed left-0 top-0 z-[60] w-max max-w-[min(18rem,calc(100vw-1rem))] rounded-xl border border-line bg-surface px-3 py-2 text-left text-[13px] leading-5 text-text shadow-xl"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
