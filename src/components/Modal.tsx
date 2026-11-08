"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

// open dialogs, newest last: Esc closes only the top one (a token picker opened from a dialog)
const stack: symbol[] = [];

/**
 * Centered dialog on desktop, a bottom sheet on phones. Esc and a click outside close it.
 * `open={false}` hides it but keeps the content mounted (a cash-out still being tracked).
 */
export function Modal({ title, onClose, children, wide = false, open = true }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; open?: boolean }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const me = Symbol("modal");
    stack.push(me);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && stack[stack.length - 1] === me && close.current();
    document.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // keyboard focus moves into the dialog and back to what opened it
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
    return () => {
      stack.splice(stack.indexOf(me), 1);
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = overflow;
      if (before?.isConnected) before.focus();
    };
  }, [open]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      hidden={!open}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={box}
        tabIndex={-1}
        className={`flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-line bg-panel outline-none sm:rounded-[28px] ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}
      >
        <div className="flex items-center justify-between gap-4 px-5 pb-2 pt-4 sm:px-6 sm:pt-5">
          <h2 id={titleId} className="truncate text-lg font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-tactile size-9 shrink-0 justify-center">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">{children}</div>
      </div>
    </div>
  );
}
