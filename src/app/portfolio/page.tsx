import type { Metadata } from "next";
import { Suspense } from "react";
import { HistoryList } from "@/components/HistoryList";
import { Positions } from "@/components/Positions";

export const metadata: Metadata = { title: "Portfolio · NearAnyStake" };

// Positions and the activity list on one page; /positions and /history redirect here (next.config.ts).
export default function PortfolioPage() {
  return (
    <div className="flex flex-col gap-10">
      <Suspense>
        <Positions />
      </Suspense>
      <section id="activity" aria-labelledby="activity-title" className="flex scroll-mt-6 flex-col gap-4">
        <div>
          <h2 id="activity-title" className="text-xl font-semibold">
            Recent activity
          </h2>
          <p className="text-sm text-muted">Stored in this browser only, with each quote exactly as 1Click signed it.</p>
        </div>
        <HistoryList />
      </section>
    </div>
  );
}
