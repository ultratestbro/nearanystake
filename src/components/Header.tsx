"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { shortAccount } from "@/lib/format";
import { useApp } from "./AppProvider";
import { Icon } from "./ui";

const NAV = [
  { href: "/stake", label: "Stake" },
  { href: "/positions", label: "Positions" },
  { href: "/history", label: "History" },
];

export function HeaderNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? "page" : undefined} className="btn-tactile shrink-0 px-3.5 py-2 text-sm font-medium">
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

/** Dry run on/off. Off needs a NEAR wallet: every live quote delivers to it. */
export function DryRunToggle({ compact = false }: { compact?: boolean }) {
  const { dryRun, setDryRun, near } = useApp();
  const blocked = !near && dryRun;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dryRun}
      onClick={() => setDryRun(!dryRun)}
      aria-disabled={blocked}
      title={blocked ? "Connect a NEAR wallet to leave dry-run mode" : dryRun ? "Dry run: real quotes, nothing payable" : "Live: deposits are real"}
      className={`btn-tactile shrink-0 gap-2 px-3 py-2 text-sm font-medium ${blocked ? "cursor-help" : ""}`}
    >
      <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition ${dryRun ? "bg-warn/80" : "bg-accent"}`}>
        <span className={`absolute size-3 rounded-full bg-bg transition ${dryRun ? "left-0.5" : "left-[14px]"}`} />
      </span>
      {compact ? (dryRun ? "Dry" : "Live") : dryRun ? "Dry run" : "Live"}
    </button>
  );
}

export function NearWalletButton() {
  const { near, restoring, connecting, connectNear, disconnectNear, error } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!near)
    return (
      <div className="flex flex-col items-end">
        <button type="button" onClick={() => void connectNear()} disabled={connecting || restoring} className="btn-tactile-accent shrink-0 px-3.5 py-2 text-sm">
          {connecting ? "Connecting…" : restoring ? "…" : "Connect NEAR"}
        </button>
        {error && <span className="mt-1 max-w-48 text-right text-xs text-danger">{error}</span>}
      </div>
    );
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="btn-tactile max-w-44 shrink-0 px-3 py-2 text-sm font-medium">
        {near.icon ? <Icon src={near.icon} alt="" size={18} /> : null}
        <span className="truncate">{shortAccount(near.accountId)}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-64 rounded-2xl border border-line bg-panel p-3 text-sm shadow-xl">
          <p className="text-xs text-muted">Connected with {near.walletName}</p>
          <p className="mt-0.5 break-all font-mono text-xs">{near.accountId}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link href="/positions" onClick={() => setOpen(false)} className="btn-tactile justify-center px-3 py-2 text-xs font-medium">
              Positions
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                disconnectNear();
              }}
              className="btn-tactile justify-center px-3 py-2 text-xs font-medium"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
