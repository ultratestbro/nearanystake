import { MARK, NEAR_N_PATH } from "@/lib/brand";

/** The NearAnyStake mark; `size` is its height. */
export function LogoMark({ size = 32, arc = true }: { size?: number; arc?: boolean }) {
  return (
    <svg width={(size * 100) / 80} height={size} viewBox={MARK.viewBox} aria-hidden className="shrink-0">
      {arc && <path d={MARK.arc} fill="none" stroke="#4a4a4a" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 7" />}
      {MARK.stack.map((c) => (
        <circle key={c.fill} {...c} />
      ))}
      <circle {...MARK.coin} fill="var(--accent)" />
      <path d={NEAR_N_PATH} transform={MARK.glyph} fill="var(--accent-ink)" />
      {arc && MARK.dots.map((d) => <circle key={d.fill} {...d} />)}
    </svg>
  );
}
