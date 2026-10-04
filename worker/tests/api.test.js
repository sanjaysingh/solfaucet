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
    it('lists Devnet', async () => {
        const response = await worker.fetch(request('/api/chains'), env());
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.chains[0]).toMatchObject({ slug: 'devnet', dripAmount: '0.01', symbol: 'SOL' });
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
