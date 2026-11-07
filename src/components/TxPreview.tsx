import type { NearTransaction } from "@anywalletkit/wallet-near";
import { formatUnits } from "@/lib/format";

const TGAS = 10n ** 12n;

/** The exact NEAR transactions a write will send, as the module built them. */
export function TxPreview({ transactions, title = "Exactly what you'll sign" }: { transactions: NearTransaction[]; title?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">{title}</p>
      {transactions.map((t, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-line bg-bg font-mono text-xs">
          <p className="border-b border-line px-3 py-2 text-muted">
            {transactions.length > 1 ? `tx ${i + 1} · ` : ""}to <span className="text-text">{t.receiverId}</span>
          </p>
          <ol className="divide-y divide-line">
            {t.actions.map((a, j) => {
              if (!("functionCall" in a)) return <li key={j} className="px-3 py-2 text-danger">unexpected action {Object.keys(a)[0]}</li>;
              const f = a.functionCall;
              const args = typeof f.args === "object" && !(f.args instanceof Uint8Array) ? JSON.stringify(f.args) : String(f.args);
              return (
                <li key={j} className="flex flex-col gap-0.5 px-3 py-2">
                  <span>
                    <span className="text-accent">{f.methodName}</span>({args === "{}" ? "" : args})
                  </span>
                  <span className="text-muted">
                    gas {((f.gas ?? 0n) / TGAS).toString()} Tgas · deposit {formatUnits(f.deposit ?? 0n, 24, 6)} NEAR
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
