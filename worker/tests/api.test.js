import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';

function env(overrides = {}) {
    return {
        ALLOWED_ORIGINS: 'https://solfaucet.sanjaysingh.net',
        COOLDOWN_KV: {
            get: vi.fn(async () => null),
            put: vi.fn(async () => {}),
        },
        COOLDOWN_SECONDS: '86400',
        PAUSED_CHAINS: '',
        TURNSTILE_SECRET_KEY: '',
        ...overrides,
    };
}

function request(path, { origin = 'https://solfaucet.sanjaysingh.net', method = 'GET', body } = {}) {
    return new Request(`https://sol-faucet-api.example${path}`, {
        method,
        headers: {
            Origin: origin,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
    });
}

describe('sol faucet api', () => {
    it('lists Devnet and Testnet', async () => {
        const response = await worker.fetch(request('/api/chains'), env());
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.chains.map((chain) => chain.slug)).toEqual(['devnet', 'testnet']);
        expect(body.chains[0]).toMatchObject({ slug: 'devnet', dripAmount: '0.01', symbol: 'SOL' });
        expect(body.chains[1]).toMatchObject({
            slug: 'testnet',
            dripAmount: '0.01',
            symbol: 'SOL',
            explorerUrl: 'https://explorer.solana.com/?cluster=testnet',
        });
    });

    it('rejects an unknown chain', async () => {
        const response = await worker.fetch(request('/api/mainnet/info'), env());
        expect(response.status).toBe(404);
    });

    it('rejects a disallowed origin', async () => {
        const response = await worker.fetch(request('/api/chains', { origin: 'https://evil.example' }), env());
        expect(response.status).toBe(403);
    });

    it('reports cooldown for an address', async () => {
        const claimedAt = Date.now() - 1000;
        const kv = {
            get: vi.fn(async () => JSON.stringify({ lastClaimAt: claimedAt })),
            put: vi.fn(async () => {}),
        };
        const address = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
        const response = await worker.fetch(
            request(`/api/devnet/cooldown/${address}`),
            env({ COOLDOWN_KV: kv, COOLDOWN_SECONDS: '86400' }),
        );
        const body = await response.json();
        expect(body.canClaim).toBe(false);
        expect(body.nextClaimAt).toBe(claimedAt + 86_400_000);
    });

    it('keeps Testnet cooldown separate from Devnet', async () => {
        const claimedAt = Date.now() - 1000;
        const kv = {
            get: vi.fn(async (key) => (
                String(key).startsWith('testnet:') ? JSON.stringify({ lastClaimAt: claimedAt }) : null
            )),
            put: vi.fn(async () => {}),
        };
        const address = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
        const devnet = await worker.fetch(
            request(`/api/devnet/cooldown/${address}`),
            env({ COOLDOWN_KV: kv }),
        );
        const testnet = await worker.fetch(
            request(`/api/testnet/cooldown/${address}`),
            env({ COOLDOWN_KV: kv }),
        );
        expect((await devnet.json()).canClaim).toBe(true);
        expect((await testnet.json()).canClaim).toBe(false);
    });

    it('pauses Testnet without stopping Devnet', async () => {
        const address = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
        const paused = await worker.fetch(
            request('/api/testnet/drip', {
                method: 'POST',
                body: JSON.stringify({ address, turnstileToken: 'token' }),
            }),
            env({ PAUSED_CHAINS: 'testnet', TURNSTILE_SECRET_KEY: 'secret' }),
        );
        expect(paused.status).toBe(503);
        expect(await paused.json()).toEqual({ error: 'Faucet is paused for this chain' });

        const open = await worker.fetch(
            request('/api/devnet/drip', {
                method: 'POST',
                body: JSON.stringify({ address }),
            }),
            env({ PAUSED_CHAINS: 'testnet', TURNSTILE_SECRET_KEY: 'secret' }),
        );
        expect(open.status).toBe(400);
        expect(await open.json()).toEqual({ error: 'Captcha token required' });
    });

    it('requires a captcha token before sending', async () => {
        const response = await worker.fetch(
            request('/api/devnet/drip', {
                method: 'POST',
                body: JSON.stringify({ address: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' }),
            }),
            env({ TURNSTILE_SECRET_KEY: 'secret' }),
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Captcha token required' });
    });
});
