import { useEffect, useState, type FormEvent } from "react";
import {
  fetchChainInfo,
  fetchCooldown,
  requestDrip,
  type ChainInfo,
  type DripSuccess,
} from "./api";
import { formatCountdown, validateAddress } from "./validation";
import { Turnstile } from "./Turnstile";

const NETWORKS = [
  { slug: "devnet", name: "Devnet" },
  { slug: "testnet", name: "Testnet" },
] as const;
const DEFAULT_SITE_KEY = "0x4AAAAAAFNrgxVXJd78eOr1";

export function App() {
  const [slug, setSlug] = useState<(typeof NETWORKS)[number]["slug"]>("devnet");
  const [info, setInfo] = useState<ChainInfo | null>(null);
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<DripSuccess | null>(null);
  const [nextClaimAt, setNextClaimAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || DEFAULT_SITE_KEY;
  const cooldownHint =
    nextClaimAt != null && nextClaimAt > now
      ? `On cooldown — next claim in ${formatCountdown(nextClaimAt, now)}`
      : null;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const next = await fetchChainInfo(slug);
        if (cancelled) return;
        setInfo(next);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setInfo(null);
          setError(err instanceof Error ? err.message : "Failed to load faucet");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    const trimmed = address.trim();
    if (!slug || !trimmed || validateAddress(trimmed)) {
      setNextClaimAt(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const status = await fetchCooldown(slug, trimmed);
        if (cancelled) return;
        setNextClaimAt(
          !status.canClaim && status.nextClaimAt ? status.nextClaimAt : null,
        );
      } catch {
        if (!cancelled) setNextClaimAt(null);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [address, slug]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const addressError = validateAddress(address);
    if (addressError) {
      setError(addressError);
      return;
    }
    if (!token) {
      setError("Complete the captcha");
      return;
    }
    if (info?.paused) {
      setError("Faucet is paused for this chain");
      return;
    }

    setSubmitting(true);
    try {
      const result = await requestDrip({
        slug,
        address: address.trim(),
        turnstileToken: token,
      });
      setSuccess(result);
      setToken("");
      setResetSignal((n) => n + 1);
      setNextClaimAt(result.nextClaimAt);
      const refreshed = await fetchChainInfo(slug);
      setInfo(refreshed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setError(message);
      setToken("");
      setResetSignal((n) => n + 1);
      if (err instanceof Error && "nextClaimAt" in err) {
        const next = (err as Error & { nextClaimAt?: number }).nextClaimAt;
        if (typeof next === "number") {
          setNextClaimAt(next);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onNetworkChange(next: string) {
    if (next !== "devnet" && next !== "testnet") return;
    setSlug(next);
    setError(null);
    setSuccess(null);
    setToken("");
    setResetSignal((n) => n + 1);
  }

  const faucetHref = info?.faucetExplorerUrl
    ?? (info?.faucetAddress
      ? `${info.explorerUrl.replace(/\/$/, "")}/address/${info.faucetAddress}?cluster=${slug}`
      : null);

  return (
    <div className="page">
      <div className="atmosphere" aria-hidden="true" />
      <header className="hero">
        <p className="brand">Sol Faucet</p>
        <h1 className="headline">Devnet and Testnet SOL, on tap.</h1>
        <p className="lede">
          Claim a small amount for development. Cooldown applies per address and IP.
        </p>
      </header>

      <main className="panel">
        {loading && !info ? (
          <p className="hint">Loading faucet…</p>
        ) : (
          <form className="form" onSubmit={onSubmit} noValidate>
            <label className="field">
              <span>Network</span>
              <select
                value={slug}
                onChange={(event) => onNetworkChange(event.target.value)}
              >
                {NETWORKS.map((network) => (
                  <option key={network.slug} value={network.slug}>
                    {network.name}
                  </option>
                ))}
              </select>
            </label>

            {info && (
              <div className="stats" aria-live="polite">
                <div>
                  <span className="stat-label">Drip</span>
                  <strong>
                    {info.dripAmount} {info.symbol}
                  </strong>
                </div>
                <div>
                  <span className="stat-label">Cooldown</span>
                  <strong>{Math.round(info.cooldownSeconds / 3600)}h</strong>
                </div>
                <div>
                  <span className="stat-label">Balance</span>
                  <strong>
                    {info.balance != null
                      ? `${Number(info.balance).toFixed(3)} ${info.symbol}`
                      : "—"}
                  </strong>
                </div>
              </div>
            )}

            <label className="field">
              <span>Wallet address</span>
              <input
                type="text"
                name="address"
                autoComplete="off"
                spellCheck={false}
                placeholder="Solana address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>

            {cooldownHint && <p className="hint">{cooldownHint}</p>}
            {info?.paused && (
              <p className="hint warn">This chain faucet is currently paused.</p>
            )}

            <Turnstile
              siteKey={siteKey}
              onToken={setToken}
              onExpire={() => setToken("")}
              resetSignal={resetSignal}
            />

            <button
              type="submit"
              className="cta"
              disabled={submitting || info?.paused}
            >
              {submitting ? "Sending…" : "Request drip"}
            </button>
          </form>
        )}

        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="banner ok" role="status">
            Sent {success.amount} {success.symbol}.{" "}
            <a href={success.explorerTxUrl} target="_blank" rel="noreferrer">
              View transaction
            </a>
          </p>
        )}
      </main>

      {info?.faucetAddress && faucetHref && (
        <footer className="footer">
          <p className="mono">
            Faucet:{" "}
            <a href={faucetHref} target="_blank" rel="noreferrer">
              {info.faucetAddress}
            </a>
          </p>
        </footer>
      )}
    </div>
  );
}
