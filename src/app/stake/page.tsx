import type { Metadata } from "next";
import { Suspense } from "react";
import { StakeFallback } from "@/components/StakeCard";
import { StakeFlow } from "@/components/StakeFlow";

export const metadata: Metadata = { title: "Stake · NearAnyStake" };

export default function StakePage() {
  return (
    <div className="pb-2">
      {/* the flow reads the URL (?flow=, ?pool=), so it renders in the browser; the fallback is what the server sends */}
      <Suspense fallback={<StakeFallback />}>
        <StakeFlow />
      </Suspense>
    </div>
  );
}
