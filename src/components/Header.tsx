"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { NEAR_N_PATH } from "@/lib/brand";
import { shortAccount } from "@/lib/format";
import { useApp } from "./AppProvider";
import { ChevronDownIcon } from "./icons";
import { Icon, Skeleton } from "./ui";

const NAV = [
  { href: "/stake", label: "Stake" },
  { href: "/portfolio", label: "Portfolio" },
];

/** Two tabs; the current one is underlined (no pressed-button look). */
export function HeaderNav({ className = "" }: { className?: string }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className={`flex gap-1 ${className}`}>
      {NAV.map((n) => {
        const current = path === n.href || path.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={current ? "page" : undefined}
            className={`relative inline-flex min-h-11 items-center rounded-md px-3 text-[15px] transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full ${
              current ? "font-semibold text-text after:bg-accent" : "font-medium text-muted hover:text-text"
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Dry run / Live, with what it means in plain words. Without a NEAR wallet it is a status, not a
 * control: live quotes deliver to that wallet, and connecting one (the account chip) turns live on
 * by itself unless the user picked dry run before (lib/dryrun.ts initialDryRun).
 */
export function DryRunToggle({ className = "" }: { className?: string }) {
  const { dryRun, setDryRun, near } = useApp();
  const id = useId();
  if (!near)
    return (
      <span
        title="Dry run shows real quotes but never creates a deposit address, so nothing can be paid by accident. Connect a NEAR wallet to go live."
        className={`inline-flex min-h-11 shrink-0 items-center gap-2 py-1 pr-1 text-left ${className}`}
      >
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-muted" />
        <span className="flex flex-col leading-4">
          <span className="text-[13px] font-medium">Dry run</span>
          <span className="text-xs text-muted">
            <span className="sm:hidden">Connect to go live</span>
            <span className="hidden sm:inline">Nothing to pay · connect a wallet to go live</span>
          </span>
        </span>
      </span>
    );
  const meaning = dryRun
    ? "Dry run shows real quotes but never creates a deposit address, so nothing can be paid by accident."
    : "Live: quotes come with a deposit address and payments are real.";
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={!dryRun}
        onClick={() => setDryRun(!dryRun)}
        aria-describedby={id}
        title={`${meaning} ${dryRun ? "Click to go live." : "Click to switch to dry run."}`}
        className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line py-1 pl-2 pr-3 text-left transition-colors hover:bg-surface ${className}`}
      >
        <span aria-hidden className={`relative h-5 w-8 shrink-0 rounded-full transition-colors ${dryRun ? "bg-surface-2" : "bg-accent"}`}>
          <span className={`absolute top-0.5 size-4 rounded-full transition-[left] ${dryRun ? "left-0.5 bg-muted" : "left-3.5 bg-accent-ink"}`} />
        </span>
        <span className="flex flex-col leading-4">
          <span className="text-[13px] font-medium">{dryRun ? "Dry run" : "Live"}</span>
          {dryRun ? (
            <span className="text-xs text-muted">
              <span className="sm:hidden">Nothing to pay</span>
              <span className="hidden sm:inline">Real quotes, nothing to pay</span>
            </span>
          ) : (
            <span className="text-xs text-muted">Payments are real</span>
          )}
        </span>
      </button>
      <span id={id} hidden>
        {meaning}
      </span>
    </>
  );
}

/** The NEAR account chip: connect, or the account with a small menu (Portfolio, Disconnect). */
export function NearWalletButton() {
  const { near, restoring, connecting, connectNear, disconnectNear, error } = useApp();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!near && restoring)
    return (
      <span role="status" className="block">
        <Skeleton className="h-11 w-36 rounded-full" />
        <span className="sr-only">Checking for a connected NEAR wallet…</span>
      </span>
    );

  if (!near)
    return (
      <div className="flex flex-col items-end">
        <button type="button" onClick={() => void connectNear()} disabled={connecting} className="btn-tactile min-h-11 shrink-0 rounded-full border border-line px-4 text-sm font-semibold">
          {connecting ? "Connecting…" : "Connect NEAR"}
        </button>
        {error && (
          <p role="alert" className="mt-1 max-w-56 text-right text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );

  return (
    <div ref={box} className="relative min-w-0">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
        className="btn-tactile min-h-11 max-w-full gap-2 rounded-full border border-line py-1 pl-1.5 pr-3 text-left"
      >
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-accent sm:size-8">
          <svg viewBox="0 0 512 512" className="size-4">
            <path d={NEAR_N_PATH} fill="var(--accent-ink)" />
          </svg>
        </span>
        <span className="flex min-w-0 flex-col leading-4">
          <span className="sr-only">NEAR account </span>
          <span className="truncate text-sm font-semibold">{shortAccount(near.accountId)}</span>
          <span className="truncate text-xs text-muted">{near.walletName}</span>
        </span>
        <ChevronDownIcon className={`hidden text-muted sm:block motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={menuId} className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-panel p-3 text-sm shadow-xl">
          <p className="flex items-center gap-2 text-xs text-muted">
            {near.icon && <Icon src={near.icon} alt="" size={16} />}
            Connected with {near.walletName}
          </p>
          <p className="mt-1 break-all font-mono text-[13px]">{near.accountId}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link href="/portfolio" onClick={() => setOpen(false)} className="btn-tactile min-h-11 justify-center px-3 text-sm font-medium">
              Portfolio
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                disconnectNear();
              }}
              className="btn-tactile min-h-11 justify-center px-3 text-sm font-medium"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
