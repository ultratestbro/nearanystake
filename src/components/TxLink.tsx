import { explorerTx } from "@/lib/near/config";
import { shortHash } from "@/lib/format";

export function TxLink({ chain, hash, className = "" }: { chain: string; hash: string; className?: string }) {
  const url = hash.startsWith("simulated") ? null : explorerTx(chain, hash);
  return url ? (
    <a className={`font-mono text-muted underline decoration-line underline-offset-2 hover:text-text ${className}`} href={url} target="_blank" rel="noreferrer" title={hash}>
      {shortHash(hash)} ↗
    </a>
  ) : (
    <span className={`font-mono text-muted ${className}`} title={hash}>
      {hash.startsWith("simulated") ? "simulated" : shortHash(hash)}
    </span>
  );
}
