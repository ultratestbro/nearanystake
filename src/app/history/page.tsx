import type { Metadata } from "next";
import { HistoryList } from "@/components/HistoryList";

export const metadata: Metadata = { title: "History · Stake Anywhere" };

export default function HistoryPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">History</h1>
        <p className="text-muted">Stored in this browser only, with each quote exactly as 1Click signed it.</p>
      </div>
      <HistoryList />
    </div>
  );
}
