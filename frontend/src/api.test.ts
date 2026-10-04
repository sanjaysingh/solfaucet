import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchChainInfo, fetchSolUsdPrice, requestDrip } from "./api";

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

  it("reads the SOL dollar price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({
        data: { amount: "150.25", base: "SOL", currency: "USD" },
      }), { status: 200 })),
    );
    await expect(fetchSolUsdPrice()).resolves.toBe(150.25);
  });

  it("returns null when the price feed fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    await expect(fetchSolUsdPrice()).resolves.toBeNull();
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
