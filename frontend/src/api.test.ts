import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchChainInfo, requestDrip } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("reads chain info", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({
        slug: "devnet",
        dripAmount: "0.01",
        symbol: "SOL",
      }), { status: 200 })),
    );
    const info = await fetchChainInfo("devnet");
    expect(info.symbol).toBe("SOL");
  });

  it("surfaces the faucet error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({
        error: "Faucet is empty",
      }), { status: 503 })),
    );
    await expect(requestDrip({
      slug: "devnet",
      address: "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk",
      turnstileToken: "token",
    })).rejects.toThrow("Faucet is empty");
  });
});
