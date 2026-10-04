import { describe, expect, it } from "vitest";
import { formatCountdown, validateAddress } from "./validation";

describe("validateAddress", () => {
  it("requires an address", () => {
    expect(validateAddress("  ")).toBe("Enter a wallet address");
  });

  it("rejects a non-base58 address", () => {
    expect(validateAddress("0xabc")).toBe("Invalid Solana address");
  });

  it("accepts a Solana address", () => {
    expect(validateAddress("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk")).toBeNull();
  });
});

describe("formatCountdown", () => {
  it("formats hours and minutes", () => {
    const now = 1_000_000;
    expect(formatCountdown(now + 3_700_000, now)).toBe("1h 1m");
  });
});
