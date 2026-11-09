import { describe, expect, it } from "vitest";
import { POST, originAllowed } from "./route";

const req = (headers: Record<string, string>, body = { jsonrpc: "2.0", id: 1, method: "gas_price", params: [null] }) =>
  new Request("http://localhost:3501/api/rpc/near", { method: "POST", headers: { "content-type": "application/json", host: "localhost:3501", ...headers }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ chain: "near" }) } as never;

describe("RPC proxy", () => {
  it("serves this app's own pages only", () => {
    expect(originAllowed(req({ origin: "http://localhost:3501" }))).toBe(true);
    expect(originAllowed(req({ origin: "https://evil.example" }))).toBe(false);
    expect(originAllowed(req({}))).toBe(false); // curl, other servers
  });

  it("refuses a foreign origin before reading the body or calling upstream", async () => {
    const r = await POST(req({ origin: "https://evil.example" }), ctx);
    expect(r.status).toBe(403);
  });
});
