/** Devnet and Testnet faucet API: send 0.01 SOL from the configured wallet. */

const DRIP_DEFAULT = 10_000_000n;
const COOLDOWN_DEFAULT = 86_400;
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
const SOL_COMPUTE_UNIT_LIMIT = 1_000;
const COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 1_000n;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_PKCS8_PREFIX = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const CHAINS = [
    { slug: 'devnet', name: 'Devnet', rpcUrl: 'https://api.devnet.solana.com' },
    { slug: 'testnet', name: 'Testnet', rpcUrl: 'https://api.testnet.solana.com' },
];

const PUBKEY_COMPARE = {
    localeMatcher: 'best fit',
    usage: 'sort',
    sensitivity: 'variant',
    ignorePunctuation: false,
    numeric: false,
    caseFirst: 'lower',
};

function concat(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function bytesEqual(left, right) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

function encodeBase58(bytes) {
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
    const digits = [0];
    for (let i = zeros; i < bytes.length; i++) {
        let carry = bytes[i];
        for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }
    let out = '1'.repeat(zeros);
    for (let i = digits.length - 1; i >= 0; i--) out += BASE58[digits[i]];
    return out;
}

function decodeBase58(text) {
    const trimmed = String(text ?? '').trim();
    if (!trimmed) throw new Error('Invalid address');
    let zeros = 0;
    while (zeros < trimmed.length && trimmed[zeros] === '1') zeros += 1;
    const size = Math.ceil((trimmed.length * Math.log(58)) / Math.log(256)) + 1;
    const decoded = new Uint8Array(size);
    for (let i = zeros; i < trimmed.length; i++) {
        const value = BASE58.indexOf(trimmed[i]);
        if (value < 0) throw new Error('Invalid address');
        let carry = value;
        for (let j = size - 1; j >= 0; j--) {
            carry += 58 * decoded[j];
            decoded[j] = carry % 256;
            carry = Math.floor(carry / 256);
        }
        if (carry !== 0) throw new Error('Invalid address');
    }
    let start = 0;
    while (start < decoded.length && decoded[start] === 0) start += 1;
    const out = new Uint8Array(zeros + (decoded.length - start));
    out.set(decoded.subarray(start), zeros);
    return out;
}

function encodeShortVec(length) {
    const out = [];
    let value = length;
    while (true) {
        let elem = value & 0x7f;
        value >>= 7;
        if (value === 0) {
            out.push(elem);
            break;
        }
        out.push(elem | 0x80);
    }
    return Uint8Array.from(out);
}

function u32le(value) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, Number(value), true);
    return out;
}

function u64le(value) {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
    return out;
}

function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function base64UrlToBytes(text) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

async function keyFromSeed(seed) {
    const pkcs8 = concat([ED25519_PKCS8_PREFIX, seed]);
    const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        pkcs8,
        { name: 'Ed25519' },
        true,
        ['sign'],
    );
    const jwk = await crypto.subtle.exportKey('jwk', privateKey);
    return { privateKey, publicKey: base64UrlToBytes(jwk.x) };
}

async function seedFromSecret(secret) {
    const trimmed = String(secret || '').trim().replace(/^['"]|['"]$/g, '');
    if (!trimmed) throw new Error('Faucet wallet is not configured');
    let bytes;
    if (trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) throw new Error('Faucet wallet is not configured');
        bytes = Uint8Array.from(parsed);
    } else {
        bytes = decodeBase58(trimmed);
    }
    let seed;
    if (bytes.length === 32) seed = bytes;
    else if (bytes.length === 64) seed = bytes.slice(0, 32);
    else throw new Error('Faucet wallet is not configured');
    const { privateKey, publicKey } = await keyFromSeed(seed);
    if (bytes.length === 64 && !bytesEqual(publicKey, bytes.slice(32))) {
        throw new Error('Faucet wallet is not configured');
    }
    return { seed, privateKey, publicKey };
}

function compileMessage({ feePayer, instructions, blockhash }) {
    const metas = [];
    const add = (pubkey, { signer = false, writable = false } = {}) => {
        const existing = metas.find((meta) => bytesEqual(meta.pubkey, pubkey));
        if (existing) {
            existing.signer = existing.signer || signer;
            existing.writable = existing.writable || writable;
            return;
        }
        metas.push({ pubkey, signer, writable });
    };
    add(feePayer, { signer: true, writable: true });
    for (const instruction of instructions) {
        add(instruction.programId, { signer: false, writable: false });
        for (const account of instruction.accounts) add(account.pubkey, account);
    }
    const comparePubkey = (left, right) => encodeBase58(left.pubkey).localeCompare(
        encodeBase58(right.pubkey),
        'en',
        PUBKEY_COMPARE,
    );
    const writableSigners = metas.filter((meta) => meta.signer && meta.writable).sort(comparePubkey);
    const payerIndex = writableSigners.findIndex((meta) => bytesEqual(meta.pubkey, feePayer));
    if (payerIndex > 0) {
        const [payer] = writableSigners.splice(payerIndex, 1);
        writableSigners.unshift(payer);
    }
    const ordered = [
        ...writableSigners,
        ...metas.filter((meta) => meta.signer && !meta.writable).sort(comparePubkey),
        ...metas.filter((meta) => !meta.signer && meta.writable).sort(comparePubkey),
        ...metas.filter((meta) => !meta.signer && !meta.writable).sort(comparePubkey),
    ];
    const indexOf = (pubkey) => ordered.findIndex((meta) => bytesEqual(meta.pubkey, pubkey));
    const parts = [
        Uint8Array.of(
            ordered.filter((meta) => meta.signer).length,
            ordered.filter((meta) => meta.signer && !meta.writable).length,
            ordered.filter((meta) => !meta.signer && !meta.writable).length,
        ),
        encodeShortVec(ordered.length),
        ...ordered.map((meta) => meta.pubkey),
        blockhash,
        encodeShortVec(instructions.length),
    ];
    for (const instruction of instructions) {
        const accountIndexes = instruction.accounts.map((account) => indexOf(account.pubkey));
        parts.push(
            Uint8Array.of(indexOf(instruction.programId)),
            encodeShortVec(accountIndexes.length),
            Uint8Array.from(accountIndexes),
            encodeShortVec(instruction.data.length),
            instruction.data,
        );
    }
    return concat(parts);
}

export async function buildAndSignSolTransfer({ seed, to, lamports, blockhash }) {
    const { privateKey, publicKey } = await keyFromSeed(seed);
    const toKey = decodeBase58(to);
    const recent = decodeBase58(blockhash);
    if (toKey.length !== 32 || recent.length !== 32) throw new Error('Invalid address');
    const budget = decodeBase58(COMPUTE_BUDGET_PROGRAM_ID);
    const system = decodeBase58(SYSTEM_PROGRAM_ID);
    const instructions = [
        { programId: budget, accounts: [], data: concat([Uint8Array.of(2), u32le(SOL_COMPUTE_UNIT_LIMIT)]) },
        { programId: budget, accounts: [], data: concat([Uint8Array.of(3), u64le(COMPUTE_UNIT_PRICE_MICRO_LAMPORTS)]) },
        {
            programId: system,
            accounts: [
                { pubkey: publicKey, signer: true, writable: true },
                { pubkey: toKey, signer: false, writable: true },
            ],
            data: concat([u32le(2), u64le(lamports)]),
        },
    ];
    const message = compileMessage({ feePayer: publicKey, instructions, blockhash: recent });
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, message));
    if (signature.length !== 64) throw new Error('Unexpected signature length');
    return {
        from: encodeBase58(publicKey),
        message,
        wire: concat([encodeShortVec(1), signature, message]),
    };
}

function allowedOrigins(env) {
    return String(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

function corsHeaders(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allow = allowedOrigins(env).includes(origin) ? origin : '';
    const headers = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
    };
    if (allow) headers['Access-Control-Allow-Origin'] = allow;
    return headers;
}

function json(request, env, data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(request, env),
        },
    });
}

function getChain(slug) {
    const normalized = String(slug || '').trim().toLowerCase();
    return CHAINS.find((chain) => chain.slug === normalized) || null;
}

function chainRpcUrl(env, chain) {
    const specific = env[`RPC_URL_${chain.slug.toUpperCase()}`];
    if (specific) return specific;
    if (chain.slug === 'devnet' && env.RPC_URL) return env.RPC_URL;
    return chain.rpcUrl;
}

function chainSecret(env, chain) {
    return env[`FAUCET_SECRET_KEY_${chain.slug.toUpperCase()}`] || env.FAUCET_SECRET_KEY || '';
}

async function rpc(env, chain, method, params) {
    const response = await fetch(chainRpcUrl(env, chain), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.error) {
        throw new Error(body?.error?.message || `RPC HTTP ${response.status}`);
    }
    return body.result;
}

async function verifyTurnstile(secret, token, remoteIp) {
    if (!secret) return 'Captcha is not configured';
    if (!token?.trim()) return 'Captcha token required';
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    if (remoteIp) form.set('remoteip', remoteIp);
    let data;
    try {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: form,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        data = await response.json();
    } catch {
        return 'Captcha verification failed';
    }
    if (!data?.success) return 'Captcha verification failed';
    return '';
}

async function hashIp(ip, salt) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function dripLamports(env) {
    const parsed = BigInt(env.DRIP_LAMPORTS || DRIP_DEFAULT);
    if (parsed <= 0n) throw new Error('Faucet amount is not configured');
    return parsed;
}

function cooldownSeconds(env) {
    const parsed = Number(env.COOLDOWN_SECONDS || COOLDOWN_DEFAULT);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : COOLDOWN_DEFAULT;
}

let sendQueue = Promise.resolve();

function enqueue(task) {
    const run = sendQueue.then(task, task);
    sendQueue = run.then(() => {}, () => {});
    return run;
}

async function sendDrip(env, chain, toAddress) {
    const { seed, publicKey } = await seedFromSecret(chainSecret(env, chain));
    const from = encodeBase58(publicKey);
    const balance = BigInt((await rpc(env, chain, 'getBalance', [from, { commitment: 'confirmed' }])).value);
    const rent = BigInt(await rpc(env, chain, 'getMinimumBalanceForRentExemption', [0]));
    const lamports = dripLamports(env);
    const latest = await rpc(env, chain, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const built = await buildAndSignSolTransfer({
        seed,
        to: toAddress,
        lamports,
        blockhash: latest.value.blockhash,
    });
    const fee = BigInt((await rpc(env, chain, 'getFeeForMessage', [
        bytesToBase64(built.message),
        { commitment: 'confirmed' },
    ])).value ?? 5000);
    if (balance < lamports + fee + rent) {
        const error = new Error('Faucet is empty');
        error.code = 'FAUCET_EMPTY';
        throw error;
    }
    const signature = await rpc(env, chain, 'sendTransaction', [
        bytesToBase64(built.wire),
        { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' },
    ]);
    return { signature, from };
}

function isPaused(env, slug) {
    return String(env.PAUSED_CHAINS || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .includes(slug);
}

function chainSummary(env, chain) {
    return {
        slug: chain.slug,
        name: chain.name,
        dripAmount: '0.01',
        cooldownSeconds: cooldownSeconds(env),
        symbol: 'SOL',
        explorerUrl: `https://explorer.solana.com/?cluster=${chain.slug}`,
    };
}

async function chainInfo(env, chain) {
    let faucetAddress = null;
    let balance = null;
    try {
        const { publicKey } = await seedFromSecret(chainSecret(env, chain));
        faucetAddress = encodeBase58(publicKey);
        const lamports = BigInt((await rpc(env, chain, 'getBalance', [faucetAddress, { commitment: 'confirmed' }])).value);
        const whole = lamports / 1_000_000_000n;
        const frac = (lamports % 1_000_000_000n).toString().padStart(9, '0').slice(0, 3);
        balance = `${whole}.${frac}`;
    } catch (err) {
        console.error('info balance lookup failed', err?.message || err);
    }
    return {
        ...chainSummary(env, chain),
        explorerUrl: 'https://explorer.solana.com',
        faucetAddress,
        faucetExplorerUrl: faucetAddress
            ? `https://explorer.solana.com/address/${faucetAddress}?cluster=${chain.slug}`
            : null,
        balance,
        paused: isPaused(env, chain.slug),
    };
}

async function lastClaim(kv, key) {
    const raw = await kv.get(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed.lastClaimAt === 'number' ? parsed.lastClaimAt : null;
    } catch {
        return null;
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(request, env) });
        }
        const origin = request.headers.get('Origin');
        if (origin && !allowedOrigins(env).includes(origin)) {
            return json(request, env, { error: 'Origin not allowed' }, 403);
        }
        if (request.method === 'GET' && url.pathname === '/') {
            return json(request, env, {
                name: 'sol-faucet-api',
                drip: '0.01',
                symbol: 'SOL',
                endpoints: [
                    'GET /api/chains',
                    'GET /api/:chain/info',
                    'GET /api/:chain/cooldown/:address',
                    'POST /api/:chain/drip',
                ],
            });
        }
        if (request.method === 'GET' && url.pathname === '/api/chains') {
            return json(request, env, {
                chains: CHAINS.map((chain) => chainSummary(env, chain)),
            });
        }
        const infoMatch = url.pathname.match(/^\/api\/([^/]+)\/info$/);
        if (request.method === 'GET' && infoMatch) {
            const chain = getChain(infoMatch[1]);
            if (!chain) {
                return json(request, env, { error: 'Unknown chain' }, 404);
            }
            return json(request, env, await chainInfo(env, chain));
        }
        const cooldownMatch = url.pathname.match(/^\/api\/([^/]+)\/cooldown\/([^/]+)$/);
        if (request.method === 'GET' && cooldownMatch) {
            const chain = getChain(cooldownMatch[1]);
            if (!chain) {
                return json(request, env, { error: 'Unknown chain' }, 404);
            }
            const address = decodeURIComponent(cooldownMatch[2]);
            if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
                return json(request, env, { error: 'Invalid address' }, 400);
            }
            const claimedAt = await lastClaim(env.COOLDOWN_KV, `${chain.slug}:addr:${address}`);
            const cooldown = cooldownSeconds(env);
            const next = claimedAt == null ? null : claimedAt + cooldown * 1000;
            const canClaim = next == null || Date.now() >= next;
            return json(request, env, {
                chain: chain.slug,
                address,
                canClaim,
                lastClaimAt: claimedAt,
                nextClaimAt: canClaim ? null : next,
            });
        }
        const dripMatch = url.pathname.match(/^\/api\/([^/]+)\/drip$/);
        if (request.method === 'POST' && dripMatch) {
            const chain = getChain(dripMatch[1]);
            if (!chain) {
                return json(request, env, { error: 'Unknown chain' }, 404);
            }
            if (isPaused(env, chain.slug)) {
                return json(request, env, { error: 'Faucet is paused for this chain' }, 503);
            }
            let body;
            try {
                body = await request.json();
            } catch {
                return json(request, env, { error: 'Invalid JSON' }, 400);
            }
            const address = String(body?.address || '').trim();
            if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
                return json(request, env, { error: 'Invalid address' }, 400);
            }
            const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
            const captchaError = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, body?.turnstileToken, ip);
            if (captchaError) {
                return json(request, env, { error: captchaError }, 400);
            }
            const now = Date.now();
            const cooldown = cooldownSeconds(env);
            const ipHash = await hashIp(ip, env.IP_HASH_SALT || 'solwallet-faucet');
            const keys = [`${chain.slug}:addr:${address}`, `${chain.slug}:ip:${ipHash}`];
            for (const key of keys) {
                const claimedAt = await lastClaim(env.COOLDOWN_KV, key);
                if (claimedAt != null && now < claimedAt + cooldown * 1000) {
                    return json(request, env, {
                        error: 'This address is on cooldown',
                        nextClaimAt: claimedAt + cooldown * 1000,
                    }, 429);
                }
            }
            try {
                const { signature } = await enqueue(() => sendDrip(env, chain, address));
                const ttl = Math.max(cooldown * 2, 86_400);
                await Promise.all(keys.map((key) => env.COOLDOWN_KV.put(
                    key,
                    JSON.stringify({ lastClaimAt: now }),
                    { expirationTtl: ttl },
                )));
                const nextClaimAt = now + cooldown * 1000;
                return json(request, env, {
                    ok: true,
                    chain: chain.slug,
                    amount: '0.01',
                    symbol: 'SOL',
                    txHash: signature,
                    explorerTxUrl: `https://explorer.solana.com/tx/${signature}?cluster=${chain.slug}`,
                    nextClaimAt,
                });
            } catch (err) {
                const message = err?.code === 'FAUCET_EMPTY'
                    ? 'Faucet is empty'
                    : (err?.message || 'Failed to send drip');
                const status = err?.code === 'FAUCET_EMPTY' || /not configured/.test(message) ? 503 : 500;
                return json(request, env, { error: message }, status);
            }
        }
        return json(request, env, { error: 'Not found' }, 404);
    },
};
