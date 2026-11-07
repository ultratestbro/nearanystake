"use client";

import { useEffect, useState } from "react";
import { backendUsage, onBackendUsage } from "@/lib/staking";

/** Says which staking backend answered: the SDK modules, or the preview while they are integrated. */
export function BackendBadge() {
  const [u, setU] = useState<ReturnType<typeof backendUsage> | null>(null);
  useEffect(() => {
    const read = () => setU(backendUsage());
    read();
    return onBackendUsage(read);
  }, []);
  if (!u || (!u.preview.length && !u.sdk.length)) return null;
  return (
    <span title={u.preview.length ? `Preview reads: ${u.preview.join(", ")}` : undefined}>
      Staking reads: {u.preview.length ? `${u.sdk.length ? "SDK + " : ""}preview (${u.preview.length} methods pending SDK integration)` : "Any Wallet Kit SDK"}.
    </span>
  );
}
