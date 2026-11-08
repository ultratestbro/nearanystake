import type { Metadata } from "next";
import { Suspense } from "react";
import { StakeFlow } from "@/components/StakeFlow";

export const metadata: Metadata = { title: "Stake · NearAnyStake" };

export default function StakePage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Stake NEAR from any chain</h1>
        <p className="text-muted">Pick where to stake, pay from any chain, sign once when the NEAR arrives.</p>
      </div>
      <Suspense>
        <StakeFlow />
      </Suspense>
    </div>
  );
}
