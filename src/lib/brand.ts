// NearAnyStake mark: a NEAR coin in front of a small stack (staked), with three chain coins
// arriving along an arc (from any chain). Shared by the header and the icons so all copies match.

/** The official NEAR "N" glyph, from NEAR's 512×512 app icon (glyph only, no tile). */
export const NEAR_N_PATH =
  "M374.461 105.525a32.07 32.07 0 0 0-27.337 15.287l-62.934 93.402c-2.047 3.087-1.218 7.236 1.852 9.286a6.7 6.7 0 0 0 8.064-.494l61.935-53.715a2.503 2.503 0 0 1 3.533.197 2.6 2.6 0 0 1 .633 1.704v168.183c0 1.383-1.145 2.495-2.534 2.495a2.5 2.5 0 0 1-1.924-.89L168.58 116.86a32.21 32.21 0 0 0-24.462-11.36h-6.554c-17.713 0-32.064 14.349-32.064 32.056v236.863c-.024 17.708 14.326 32.056 32.039 32.056a32.07 32.07 0 0 0 27.337-15.287l62.934-93.402c2.047-3.087 1.218-7.236-1.852-9.286a6.7 6.7 0 0 0-8.064.494l-61.935 53.715a2.503 2.503 0 0 1-3.533-.197 2.6 2.6 0 0 1-.633-1.704V172.575c0-1.383 1.145-2.494 2.534-2.494.731 0 1.437.321 1.924.889l187.145 224.17a32.21 32.21 0 0 0 24.462 11.36h6.554c17.713 0 32.064-14.324 32.088-32.031V137.581c.024-17.708-14.326-32.056-32.039-32.056";

export const MARK = {
  viewBox: "0 0 100 80",
  arc: "M7 60 C 6 34, 22 14, 44 9",
  stack: [
    { cx: 68, cy: 50, r: 25, fill: "#007a4f" },
    { cx: 62, cy: 45, r: 25, fill: "#00b377" },
  ],
  coin: { cx: 56, cy: 40, r: 25 },
  /** Scales the 512-box glyph to ~27 px, centred on the coin. */
  glyph: "translate(42 26) scale(0.0547)",
  /** Solana, Base and Bitcoin coins on the way in. */
  dots: [
    { cx: 7, cy: 58, r: 4.5, fill: "#9945FF" },
    { cx: 13, cy: 30, r: 5, fill: "#0052FF" },
    { cx: 31, cy: 13, r: 4, fill: "#F7931A" },
  ],
};
