/**
 * Read-mostly JSON-RPC proxy for the browser. NEAR: view calls only, with the 375 KB `validators`
 * answer cached for a minute (critique: never hammer the public node from every visitor). Solana and
 * TON: the calls their deposit builders need. NEAR wallets broadcast on their own, so no NEAR send
 * method is allowed here.
 */
const NEAR_METHODS = new Set(["query", "validators", "block", "gas_price", "status", "tx", "EXPERIMENTAL_tx_status", "EXPERIMENTAL_protocol_config"]);
const NEAR_QUERY_TYPES = new Set(["view_account", "call_function", "view_access_key"]);

const UPSTREAM: Record<string, { urls: () => string[]; allow: (c: { method?: unknown; params?: unknown }) => boolean }> = {
  near: {
    urls: () => (process.env.NEAR_RPC_URLS ?? "https://free.rpc.fastnear.com,https://rpc.mainnet.fastnear.com,https://near.drpc.org").split(",").map((s) => s.trim()).filter(Boolean),
    allow: (c) => {
      if (!NEAR_METHODS.has(String(c.method))) return false;
      if (c.method !== "query") return true;
      return NEAR_QUERY_TYPES.has(String((c.params as { request_type?: unknown } | undefined)?.request_type));
    },
  },
  solana: {
    urls: () => [process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com"],
    allow: (c) =>
      [
        "getLatestBlockhash", "getAccountInfo", "getMultipleAccounts", "getBalance", "getTokenAccountBalance", "getMinimumBalanceForRentExemption",
        "simulateTransaction", "getFeeForMessage", "getRecentPrioritizationFees", "getSignatureStatuses", "getEpochInfo", "getSlot", "sendTransaction",
      ].includes(String(c.method)),
  },
  ton: {
    urls: () => [process.env.TON_RPC_URL ?? "https://toncenter.com/api/v2/jsonRPC"],
    allow: (c) => ["runGetMethod", "getAddressBalance", "getAddressInformation"].includes(String(c.method)),
  },
};

const cache = new Map<string, { at: number; body: string }>();
const TTL: Record<string, number> = { validators: 60_000, gas_price: 30_000 };
/** A block by height never changes (the epoch clock reads the same few headers over and over). */
const ttlOf = (c: { method?: unknown; params?: unknown }) =>
  c.method === "block" && typeof (c.params as { block_id?: unknown } | undefined)?.block_id === "number" ? 3_600_000 : TTL[String(c.method)];
/** Public nodes answer a rate limit with HTTP 200 and a JSON-RPC error: that is a reason to fail over too. */
const RATE_LIMITED = /"code"\s*:\s*-429|Rate limits exceeded|TooManyRequests|Too Many Requests/i;

export async function POST(request: Request, ctx: RouteContext<"/api/rpc/[chain]">) {
  const { chain } = await ctx.params;
  const up = UPSTREAM[chain];
  if (!up) return Response.json({ error: "unknown chain" }, { status: 404 });
  const text = await request.text();
  if (text.length > 100_000) return Response.json({ error: "too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (Array.isArray(body) || !body || typeof body !== "object") return Response.json({ error: "one call per request" }, { status: 400 });
  const call = body as { id?: unknown; method?: unknown; params?: unknown };
  if (!up.allow(call)) {
    console.warn(`rpc proxy: refused ${chain} ${String(call.method)}`);
    return Response.json({ error: "method not allowed" }, { status: 403 });
  }

  const ttl = chain === "near" ? ttlOf(call) : undefined;
  const key = ttl ? `${call.method}:${JSON.stringify(call.params)}` : null;
  const hit = key ? cache.get(key) : undefined;
  if (key && hit && ttl && Date.now() - hit.at < ttl) return reply(hit.body, call.id);

  let lastStatus = 502;
  let lastBody: string | null = null;
  const urls = up.urls();
  // two passes over the list, the second after a short pause: free tiers recover within a second
  for (let pass = 0; pass < 2; pass++) {
    if (pass) await new Promise((r) => setTimeout(r, 400));
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(15_000) });
        const out = await res.text();
        // rate limits (429 or a -429 body), retired endpoints (410) and outages: try the next node
        if (!res.ok || RATE_LIMITED.test(out.slice(0, 300))) {
          lastStatus = res.ok ? 429 : res.status;
          lastBody = out;
          continue;
        }
        if (key && !/"error"/.test(out.slice(0, 200))) cache.set(key, { at: Date.now(), body: out });
        return reply(out, call.id, res.status);
      } catch {
        // next upstream
      }
    }
  }
  // every node refused: a cached validator set or block from a few minutes ago beats an error page
  if (key && hit && Date.now() - hit.at < 30 * 60_000) return reply(hit.body, call.id);
  return lastBody ? reply(lastBody, call.id, lastStatus) : Response.json({ error: "upstream unavailable" }, { status: lastStatus });
}

/** A cached answer carries the id of the call it answered first; give it this call's id. */
function reply(body: string, id: unknown, status = 200) {
  try {
    const j = JSON.parse(body) as { id?: unknown };
    j.id = id;
    return Response.json(j, { status });
  } catch {
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }
}
