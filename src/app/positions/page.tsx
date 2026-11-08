import type { Metadata } from "next";
import { Suspense } from "react";
import { Positions } from "@/components/Positions";

export const metadata: Metadata = { title: "Positions · NearAnyStake" };

export default function PositionsPage() {
  return (
    <Suspense>
      <Positions />
    </Suspense>
  );
}
