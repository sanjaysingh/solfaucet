import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import * as api from "./api";

vi.mock("./Turnstile", () => ({
  Turnstile: ({
    onToken,
  }: {
    onToken: (token: string) => void;
  }) => (
    <button type="button" onClick={() => onToken("test-token")}>
      Solve captcha
    </button>
  ),
}));

const info = {
  slug: "devnet",
  name: "Devnet",
  dripAmount: "0.01",
  symbol: "SOL",
  cooldownSeconds: 86400,
  explorerUrl: "https://explorer.solana.com",
  faucetAddress: "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk",
  faucetExplorerUrl:
    "https://explorer.solana.com/address/HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk?cluster=devnet",
  balance: "1.500",
  paused: false,
};

beforeEach(() => {
  vi.spyOn(api, "fetchSolUsdPrice").mockResolvedValue(200);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App", () => {
  it("renders Devnet and the drip amount", async () => {
    vi.spyOn(api, "fetchChainInfo").mockResolvedValue(info);
    render(<App />);

    expect(screen.getByText("Sol Faucet")).toBeInTheDocument();
    await waitFor(() => {
      const select = screen.getByRole("combobox");
      expect(select).toHaveValue("devnet");
      expect(select).toBeEnabled();
      expect(screen.getByRole("option", { name: "Testnet" })).toBeInTheDocument();
      expect(screen.getByText("0.01 SOL")).toBeInTheDocument();
      expect(screen.getByRole("contentinfo")).toHaveTextContent("$300.00");
    });
    expect(screen.getByRole("link", { name: info.faucetAddress })).toHaveAttribute(
      "href",
      info.faucetExplorerUrl,
    );
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent(info.faucetAddress);
    expect(footer).toHaveTextContent("1.500 SOL");
    expect(footer).toHaveTextContent("$300.00");
  });

  it("validates the address before submitting", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchChainInfo").mockResolvedValue({ ...info, faucetAddress: null, faucetExplorerUrl: null });
    const drip = vi.spyOn(api, "requestDrip");

    render(<App />);
    await waitFor(() => expect(screen.getByText("0.01 SOL")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Solve captcha" }));
    await user.click(screen.getByRole("button", { name: "Request drip" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a wallet address");
    expect(drip).not.toHaveBeenCalled();
  });

  it("loads Testnet when the network changes", async () => {
    const user = userEvent.setup();
    const fetchInfo = vi.spyOn(api, "fetchChainInfo").mockImplementation(async (next) => ({
      ...info,
      slug: next,
      name: next === "testnet" ? "Testnet" : "Devnet",
      faucetExplorerUrl: `https://explorer.solana.com/address/${info.faucetAddress}?cluster=${next}`,
    }));

    render(<App />);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("devnet"));
    await user.selectOptions(screen.getByRole("combobox"), "testnet");

    await waitFor(() => expect(fetchInfo).toHaveBeenCalledWith("testnet"));
    expect(screen.getByRole("combobox")).toHaveValue("testnet");
    expect(screen.getByRole("link", { name: info.faucetAddress })).toHaveAttribute(
      "href",
      "https://explorer.solana.com/address/HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk?cluster=testnet",
    );
  });
});
