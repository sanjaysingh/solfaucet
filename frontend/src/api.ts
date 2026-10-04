export type ChainSummary = {
  slug: string;
  name: string;
  dripAmount: string;
  cooldownSeconds: number;
  symbol: string;
  explorerUrl: string;
};

export type ChainInfo = {
  slug: string;
  name: string;
  dripAmount: string;
  symbol: string;
  cooldownSeconds: number;
  explorerUrl: string;
  faucetAddress: string | null;
  faucetExplorerUrl: string | null;
  balance: string | null;
  paused: boolean;
};

export type CooldownStatus = {
  chain: string;
  address: string;
  canClaim: boolean;
  lastClaimAt: number | null;
  nextClaimAt: number | null;
};

export type DripSuccess = {
  ok: true;
  chain: string;
  txHash: string;
  amount: string;
  symbol: string;
  explorerTxUrl: string;
  nextClaimAt: number;
};

export type ApiError = {
  error: string;
  nextClaimAt?: number;
};

/** Production Worker URL; override with VITE_FAUCET_API_URL for local/dev. */
export const DEFAULT_FAUCET_API_URL = "https://sol-faucet-api.times2.workers.dev";

function apiBase(): string {
  const base = import.meta.env.VITE_FAUCET_API_URL || DEFAULT_FAUCET_API_URL;
  return base.replace(/\/$/, "");
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & ApiError;
  if (!res.ok) {
    const message =
      typeof data?.error === "string" ? data.error : `Request failed (${res.status})`;
    const err = new Error(message) as Error & { status?: number; nextClaimAt?: number };
    err.status = res.status;
    if (typeof data?.nextClaimAt === "number") err.nextClaimAt = data.nextClaimAt;
    throw err;
  }
  return data;
}

export async function fetchChainInfo(slug: string): Promise<ChainInfo> {
  const res = await fetch(`${apiBase()}/api/${encodeURIComponent(slug)}/info`);
  return parseJson<ChainInfo>(res);
}

/** Mainnet SOL/USD spot price, used to show a dollar value for faucet balances. */
export async function fetchSolUsdPrice(): Promise<number | null> {
  try {
    const res = await fetch("https://api.coinbase.com/v2/prices/SOL-USD/spot");
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { amount?: string } };
    const usd = Number(data?.data?.amount);
    return Number.isFinite(usd) && usd > 0 ? usd : null;
  } catch {
    return null;
  }
}

export async function fetchCooldown(
  slug: string,
  address: string,
): Promise<CooldownStatus> {
  const res = await fetch(
    `${apiBase()}/api/${encodeURIComponent(slug)}/cooldown/${encodeURIComponent(address)}`,
  );
  return parseJson<CooldownStatus>(res);
}

export async function requestDrip(params: {
  slug: string;
  address: string;
  turnstileToken: string;
}): Promise<DripSuccess> {
  const res = await fetch(
    `${apiBase()}/api/${encodeURIComponent(params.slug)}/drip`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: params.address,
        turnstileToken: params.turnstileToken,
      }),
    },
  );
  return parseJson<DripSuccess>(res);
}
