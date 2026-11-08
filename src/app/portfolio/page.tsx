import type { Metadata } from "next";
import { Suspense } from "react";
import { HistoryList } from "@/components/HistoryList";
import { Positions } from "@/components/Positions";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Portfolio · NearAnyStake" };

// The total, positions, the NEAR on the account and recent activity on one page; /positions and
// /history redirect here (next.config.ts). Recent activity sits in the positions column, so it is
// handed to Positions to place.
export default function PortfolioPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full rounded-3xl" />}>
      <Positions activity={<HistoryList />} />
    </Suspense>
  );
}
