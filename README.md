# Sol Faucet

A Devnet and Testnet faucet for claiming small amounts of SOL while building and testing. Live at [solfaucet.sanjaysingh.net](https://solfaucet.sanjaysingh.net/).

Devnet and Testnet are both enabled. Each claim is rate-limited (per address and IP, separately on each network), behind a captcha, and sends 0.01 SOL from a wallet configured on the faucet worker.

## Tech stack

- React and Vite for the frontend
- Cloudflare Workers for the API
- Cloudflare KV for cooldown records
- WebCrypto for Devnet transaction signing
- Cloudflare Turnstile for bot protection

```
frontend/   UI
worker/     API
.github/    CI and deployment workflows
```

## How it works

Devnet and Testnet defaults:

- `0.01` SOL per claim
- 24h cooldown per address and per IP, tracked separately on each network

Keep the faucet wallet lightly funded on both Devnet and Testnet. The same secret is used for both unless a network-specific secret is set. Do not point it at a wallet that holds mainnet SOL.

Browser requests are restricted by the `ALLOWED_ORIGINS` setting in
[`worker/wrangler.jsonc`](worker/wrangler.jsonc). The deployed configuration
allows `https://solfaucet.sanjaysingh.net` and `https://solwallet.sanjaysingh.net`,
along with local development origins.

## Getting started

### Worker

```bash
cd worker
cp .dev.vars.example .dev.vars
npm install
npm run dev
```

Fill in `.dev.vars` before starting the worker. It contains the Turnstile
secret and the Devnet faucet secret key (base58, or a JSON byte array). Never
commit this file.

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

The example environment file points the UI at
`http://127.0.0.1:8787`. Replace `VITE_TURNSTILE_SITE_KEY` with a valid
Turnstile site key configured to allow your local hostname.

### Useful scripts

```bash
# from the repository root
npm test

# from worker/ or frontend/
npm test

# worker
npm run deploy

# frontend
npm run build
npm run preview
```

## API

Base URL: `https://sol-faucet-api.times2.workers.dev` (override locally with `VITE_FAUCET_API_URL`).

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/` | service name and available endpoints |
| `GET` | `/api/chains` | enabled chains |
| `GET` | `/api/:chain/info` | balance, drip size, cooldown, faucet address |
| `GET` | `/api/:chain/cooldown/:address` | address cooldown only; IP cooldown is checked when claiming |
| `POST` | `/api/:chain/drip` | `{ "address", "turnstileToken" }` |

The claim endpoint validates the address and Turnstile token, checks address
and IP cooldowns, and then sends 0.01 SOL. It returns `429` when either cooldown is active.

Browser requests with an `Origin` header must come from `ALLOWED_ORIGINS`;
other origins receive `403`. Requests without an `Origin` header, such as
server-to-server calls, are accepted by the CORS check, but claims still
require a valid Turnstile token.

## Deploy

### Cloudflare Worker

KV is wired in [`worker/wrangler.jsonc`](worker/wrangler.jsonc). Deploy with:

```bash
cd worker && npx wrangler deploy
```

Secrets (not in git):

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put FAUCET_SECRET_KEY
```

`FAUCET_SECRET_KEY` is the faucet wallet secret: base58, or the JSON byte array from `solana-keygen`. It is used for both Devnet and Testnet. Set `FAUCET_SECRET_KEY_DEVNET` or `FAUCET_SECRET_KEY_TESTNET` only when a network should use a different wallet. Each account must hold enough SOL on that network for each 0.01 drip, the fee, and the rent-exempt minimum.

Vars already in `wrangler.jsonc`:

- `ALLOWED_ORIGINS` — the deployed sites plus localhost and `127.0.0.1` on ports `5173`, `8000`, and `9876`
- `RPC_URL` — optional Devnet override. The defaults are `https://api.devnet.solana.com` and `https://api.testnet.solana.com`. `RPC_URL_DEVNET` and `RPC_URL_TESTNET` override one network.
- `DRIP_LAMPORTS` — `10000000` (0.01 SOL)
- `COOLDOWN_SECONDS` — `86400`
- `PAUSED_CHAINS` — optional, e.g. `testnet` to shut one network off

### GitHub Actions

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pull requests
and pushes to `main`. Jobs are selected by changed paths: worker changes run
tests, while frontend changes run typecheck, tests, and a build.
The aggregate job is named `CI`.

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) deploys changed
parts on pushes to `main`: the frontend goes to GitHub Pages and the API goes
to Cloudflare Workers. For a manual run, select `deploy_frontend`,
`deploy_worker`, or both in the workflow form.

Secrets / vars used by deploy:

- `CF_API_TOKEN`, `CF_ACCOUNT_ID` — worker deploy
- `VITE_FAUCET_API_URL` — optional secret or repository variable; defaults to `https://sol-faucet-api.times2.workers.dev`
- `VITE_TURNSTILE_SITE_KEY` — optional secret or repository variable; the frontend has a public site-key default

GitHub Pages source should be **GitHub Actions**. The custom domain is `solfaucet.sanjaysingh.net`.
