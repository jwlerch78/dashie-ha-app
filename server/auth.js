// server/auth.js
// Persistent JWT storage + Dashie auth edge function calls.

const fs = require('fs');
const crypto = require('crypto');
const { JWT_FILE, SERVICE_TOKEN_FILE, SUPABASE } = require('./config');

const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // refresh when <24h remain

/** Read stored JWT; returns null if missing / expired. */
function readStoredJwt() {
    try {
        if (!fs.existsSync(JWT_FILE)) return null;
        const data = JSON.parse(fs.readFileSync(JWT_FILE, 'utf8'));
        if (!data?.jwt || !data?.expiry) return null;
        if (Date.now() >= data.expiry) return null;
        return data;
    } catch (e) {
        console.error('[auth] Failed to read stored JWT:', e.message);
        return null;
    }
}

/** Write JWT atomically. Input: { jwt, userId, userEmail }. Expiry parsed from the JWT. */
function writeStoredJwt({ jwt, userId, userEmail }) {
    let expiry = null;
    try {
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
        expiry = payload.exp ? payload.exp * 1000 : null;
    } catch (e) {
        console.warn('[auth] Could not parse JWT expiry:', e.message);
    }
    const data = { jwt, expiry, userId, userEmail, savedAt: Date.now() };
    const tmp = JWT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, JWT_FILE);
    return data;
}

function clearStoredJwt() {
    try { fs.unlinkSync(JWT_FILE); } catch (e) {}
}

/** Get or generate the local service token (UUID). Shown to the user for voice pipeline module config. */
function getOrCreateServiceToken() {
    try {
        if (fs.existsSync(SERVICE_TOKEN_FILE)) {
            return fs.readFileSync(SERVICE_TOKEN_FILE, 'utf8').trim();
        }
    } catch (e) {}
    const token = crypto.randomUUID();
    fs.writeFileSync(SERVICE_TOKEN_FILE, token);
    return token;
}

// ------------------------------------------------------------------
//  Dashie auth edge function calls
// ------------------------------------------------------------------

const EDGE_FN_URL = SUPABASE.url + '/functions/v1/jwt-auth';

/** Exchange an OAuth authorization code (from Google) for Google tokens, via the Dashie edge function. */
async function exchangeOAuthCode(code, redirectUri) {
    const resp = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE.anonKey}`,
        },
        body: JSON.stringify({
            operation: 'exchange_code',
            data: { code, redirect_uri: redirectUri, provider_type: 'web_oauth' },
        }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`exchange_code failed: ${resp.status} ${body}`);
    }
    const result = await resp.json();
    if (!result.success || !result.tokens) {
        throw new Error(`exchange_code invalid response: ${JSON.stringify(result)}`);
    }
    return result.tokens;
}

/** Given a Google access token, bootstrap a Supabase JWT via the Dashie edge function. */
async function bootstrapJwt(googleAccessToken) {
    const resp = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE.anonKey}`,
        },
        body: JSON.stringify({
            operation: 'bootstrap_jwt',
            googleAccessToken,
            provider: 'google',
        }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`bootstrap_jwt failed: ${resp.status} ${body}`);
    }
    const result = await resp.json();
    if (!result.success || !result.jwtToken) {
        throw new Error(`bootstrap_jwt invalid response: ${JSON.stringify(result)}`);
    }
    return { jwt: result.jwtToken, user: result.user, access: result.access };
}

/** Refresh the stored JWT. Returns the new stored data. */
async function refreshJwt(currentJwt) {
    const resp = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentJwt}`,
            'apikey': SUPABASE.anonKey,
        },
        body: JSON.stringify({ operation: 'refresh_jwt', jwtToken: currentJwt }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`refresh_jwt failed: ${resp.status} ${body}`);
    }
    const result = await resp.json();
    if (!result.success || !result.jwtToken) {
        throw new Error(`refresh_jwt invalid response: ${JSON.stringify(result)}`);
    }
    return writeStoredJwtFromToken(result.jwtToken);
}

function writeStoredJwtFromToken(jwt) {
    let userId = null;
    let userEmail = null;
    try {
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
        userId = payload.sub || null;
        userEmail = payload.email || null;
    } catch (e) {}
    return writeStoredJwt({ jwt, userId, userEmail });
}

/**
 * Return a valid JWT, refreshing if necessary. Throws if not authenticated.
 */
async function getValidJwt() {
    const stored = readStoredJwt();
    if (!stored) throw new Error('Not authenticated');

    const timeLeft = stored.expiry - Date.now();
    if (timeLeft > REFRESH_THRESHOLD_MS) return stored;

    // Refresh proactively
    try {
        return await refreshJwt(stored.jwt);
    } catch (e) {
        console.warn('[auth] Refresh failed, using existing JWT until expiry:', e.message);
        return stored;
    }
}

module.exports = {
    readStoredJwt,
    writeStoredJwt,
    writeStoredJwtFromToken,
    clearStoredJwt,
    getOrCreateServiceToken,
    exchangeOAuthCode,
    bootstrapJwt,
    refreshJwt,
    getValidJwt,
};
