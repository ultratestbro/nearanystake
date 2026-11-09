import { describe, expect, it } from "vitest";
import delivery from "./__fixtures__/near-delivery-tx.json";
import { stakeAmountAfterDelivery, transferredTo } from "./stakeAmount";

const NEAR = 10n ** 24n;
const MIN = 10n ** 21n;

describe("stake only what was delivered", () => {
  it("an account that already held 1000 NEAR stakes exactly the 0.73 delivered", () => {
    const delivered = 730n * 10n ** 21n;
    const r = stakeAmountAfterDelivery({ reported: delivered, onChain: null, maxStakeable: 1000n * NEAR + delivered - 2n * 10n ** 22n, minStake: MIN });
    expect(r).toEqual({ amount: delivered, basis: "reported", mismatch: false, capped: false, tooSmall: false });
  });

  it("uses the lower of the NEAR transaction and 1Click's report: neither can inflate the stake", () => {
    const r = stakeAmountAfterDelivery({ reported: 800n * 10n ** 21n, onChain: 755n * 10n ** 21n, maxStakeable: 10n * NEAR, minStake: MIN });
    expect(r).toMatchObject({ amount: 755n * 10n ** 21n, basis: "on-chain", mismatch: true });
    // a lying proxy (or a batched transaction summed) reports more on chain than 1Click delivered
    const inflated = stakeAmountAfterDelivery({ reported: 755n * 10n ** 21n, onChain: 5n * NEAR, maxStakeable: 10n * NEAR, minStake: MIN });
    expect(inflated).toMatchObject({ amount: 755n * 10n ** 21n, basis: "reported", mismatch: true });
    expect(stakeAmountAfterDelivery({ reported: NEAR, onChain: NEAR, maxStakeable: 10n * NEAR, minStake: MIN })).toMatchObject({ basis: "on-chain", mismatch: false });
  });

  it("a fresh account created by the delivery is capped by what it can spend (reserve + gas + storage)", () => {
    const delivered = 755320382313437861848237n;
    const spendable = delivered - 2n * 10n ** 22n - 5n * 10n ** 21n - 182n * 10n ** 19n;
    const r = stakeAmountAfterDelivery({ reported: delivered, onChain: delivered, maxStakeable: spendable, minStake: MIN });
    expect(r).toMatchObject({ amount: spendable, capped: true, tooSmall: false });
  });

  it("refuses dust below the module minimum", () => {
    expect(stakeAmountAfterDelivery({ reported: 5n * 10n ** 20n, onChain: null, maxStakeable: NEAR, minStake: MIN })).toMatchObject({ amount: 0n, tooSmall: true });
    expect(stakeAmountAfterDelivery({ reported: NEAR, onChain: null, maxStakeable: 0n, minStake: MIN })).toMatchObject({ amount: 0n, tooSmall: true });
  });

  it("throws before anything was delivered", () => {
    expect(() => stakeAmountAfterDelivery({ reported: null, onChain: null, maxStakeable: NEAR, minStake: MIN })).toThrow();
  });
});

describe("transferredTo on the recorded mainnet delivery (AQAkvxyT…)", () => {
  const recipient = "fc647e203e0e099212485017b78a0e77dc330019d4b532a4d44408adc0bfd9a1";
  it("finds the native NEAR intents.near paid the fresh implicit account", () => {
    expect(transferredTo(delivery.receipts, recipient)).toBe(755320382313437861848237n);
  });
  it("ignores system gas refunds and other receivers", () => {
    expect(transferredTo(delivery.receipts, "intents.near")).toBeNull();
    expect(transferredTo(delivery.receipts, "someone-else.near")).toBeNull();
  });
});
