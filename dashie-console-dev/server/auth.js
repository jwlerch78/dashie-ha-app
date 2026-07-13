// server/auth.js
// Persistent JWT storage + Dashie device-flow auth.
//
// Flow:
//   1. Add-on calls start-link → edge function `create_device_code` → returns device_code,
//      user_code, verification_url.
//   2. Frontend opens verification_url in a new browser tab — user does Google OAuth there in
//      their regular browser session (not in HA's iframe).
//   3. Add-on polls `poll_device_code_status` every few seconds.
//   4. Once user approves in the browser tab, poll returns { authorized: true, jwtToken, user }.
//   5. Add-on persists JWT to /data/dashie_auth.json.

const fs = require('fs');
const crypto = require('crypto');
const { JWT_FILE, SERVICE_TOKEN_FILE, SUPABASE, SUPABASE_ENV } = require('./config');

const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // refresh when <24h remain
const DEVICE_TYPE = 'ha_app';                      // baked into JWT custom claims
const EDGE_FN_URL = SUPABASE.url + '/functions/v1/jwt-auth';

// Host for the verification page — must match the Supabase env. PROD web lives at
// app.dashieapp.com (dashieapp.com is the marketing site → /auth 404s); staging at
// dev.dashieapp.com. The page is /auth.html on both.
const VERIFICATION_BASE_URL = SUPABASE_ENV === 'production'
    ? 'https://app.dashieapp.com'
    : 'https://dev.dashieapp.com';

// ------------------------------------------------------------------
//  JWT file I/O
// ------------------------------------------------------------------

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

/** Write JWT atomically. Identity fields (userId/Email/Name/Picture) are
 *  preserved across refreshes when the caller doesn't provide new values —
 *  reads the previous storage and inherits anything missing. The JWT payload
 *  is also consulted (sub, email, name, picture claims) as a final fallback. */
function writeStoredJwt({ jwt, userId, userEmail, userName, userPicture }) {
    let expiry = null;
    let payload = {};
    try {
        payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
        expiry = payload.exp ? payload.exp * 1000 : null;
    } catch (e) {
        console.warn('[auth] Could not parse JWT payload:', e.message);
    }
    // Inherit anything the caller didn't pass from the previous storage so a
    // bare refresh (writeStoredJwt({jwt}) on refreshJwt) doesn't wipe identity.
    const prev = readStoredJwt() || {};
    const meta = payload.user_metadata || {};
    userId       = userId       ?? prev.userId       ?? payload.sub                                    ?? null;
    userEmail    = userEmail    ?? prev.userEmail    ?? payload.email   ?? meta.email                  ?? null;
    userName     = userName     ?? prev.userName     ?? payload.name    ?? meta.name    ?? meta.full_name ?? null;
    userPicture  = userPicture  ?? prev.userPicture  ?? payload.picture ?? meta.picture ?? meta.avatar_url ?? null;

    // Account CHANGED (signed in as a different account — including a wiped-and-recreated
    // account, which gets a brand-new auth user id). Household Sharing lives in
    // settings-store on the add-on's /data volume — PER INSTANCE, not per account — so
    // without this the new account silently inherits the previous account's sharing state,
    // and the first-open "turn on Household Sharing" prompt (gated on sharing being off)
    // never fires. Sign-out resets it too, but a re-signup without an explicit sign-out
    // would otherwise slip through. Lazy require: keeps auth.js free of a load-time dep.
    if (prev.userId && userId && prev.userId !== userId) {
        try {
            require('./settings-store').writeSettings({ householdSharing: false });
            console.log(`[auth] account changed (${String(prev.userId).slice(0, 8)}… → ${String(userId).slice(0, 8)}…) — reset householdSharing=false`);
        } catch (e) {
            console.warn('[auth] household-sharing reset on account change failed (non-fatal):', e.message);
        }
    }

    const data = { jwt, expiry, userId, userEmail, userName, userPicture, savedAt: Date.now() };
    const tmp = JWT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, JWT_FILE);
    return data;
}

function clearStoredJwt() {
    try { fs.unlinkSync(JWT_FILE); } catch (e) {}
}

/** Local service token — shown to user for voice pipeline module config (not a secret). */
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
//  Device flow edge function calls
// ------------------------------------------------------------------

async function edgeFnCall(operation, data = {}, authHeader = null) {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': authHeader || `Bearer ${SUPABASE.anonKey}`,
    };
    const resp = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ operation, data }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`${operation} HTTP ${resp.status}: ${body}`);
    }
    return resp.json();
}

/** Create a device code. Returns { device_code, user_code, verification_url, expires_in, interval }. */
async function createDeviceCode({ packageVersion } = {}) {
    const result = await edgeFnCall('create_device_code', {
        device_type: DEVICE_TYPE,
        base_url: VERIFICATION_BASE_URL,
        device_info: {
            model: 'Dashie Console',
            os_version: process.versions?.node ? `node-${process.versions.node}` : 'unknown',
            app_version: packageVersion || require('../package.json').version,
        },
    });
    if (!result.success) throw new Error(`create_device_code failed: ${JSON.stringify(result)}`);

    // The edge function ignores our base_url param and echoes the prod host + (on the prod
    // project, a stale) /auth path — e.g. https://dashieapp.com/auth?code=… which 404s
    // (dashieapp.com is marketing; the page is /auth.html on app.dashieapp.com). Rebuild the
    // URL to this env's canonical auth page, preserving the query (code + type), so the user
    // always lands on a working page regardless of the edge fn's output.
    let verification_url = result.verification_url;
    try {
        const q = new URL(verification_url).search;   // e.g. "?code=…&type=ha_app"
        verification_url = `${VERIFICATION_BASE_URL}/auth.html${q}`;
    } catch (e) {
        verification_url = `${VERIFICATION_BASE_URL}/auth.html?code=${encodeURIComponent(result.user_code || '')}&type=${DEVICE_TYPE}`;
    }

    return {
        device_code: result.device_code,
        user_code: result.user_code,
        verification_url,
        expires_in: result.expires_in,
        interval: result.interval || 5,
    };
}

/**
 * Poll the device code status.
 * Returns one of:
 *   { status: 'pending' }       — keep polling
 *   { status: 'authorized', jwtStored: {...} }  — user approved; JWT is now persisted
 *   { status: 'expired' }       — device code expired; start over
 */
async function pollDeviceCode(deviceCode) {
    const result = await edgeFnCall('poll_device_code_status', { device_code: deviceCode });
    if (result.success && result.jwtToken) {
        const stored = writeStoredJwt({
            jwt: result.jwtToken,
            userId: result.user?.id,
            userEmail: result.user?.email,
            userName: result.user?.name,
            userPicture: result.user?.picture,
        });
        return { status: 'authorized', jwtStored: stored };
    }
    const pending = result.status === 'authorization_pending' || (!result.success && !result.status);
    if (pending) return { status: 'pending' };
    if (result.status === 'expired_token' || result.status === 'expired') return { status: 'expired' };
    // Unknown state — treat as pending to be safe
    return { status: 'pending', raw: result };
}

// ------------------------------------------------------------------
//  JWT refresh
// ------------------------------------------------------------------

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
    return writeStoredJwt({ jwt: result.jwtToken });
}

/** Return a valid JWT, refreshing if near expiry. Throws if not authenticated. */
async function getValidJwt() {
    const stored = readStoredJwt();
    if (!stored) throw new Error('Not authenticated');

    const timeLeft = stored.expiry - Date.now();
    if (timeLeft > REFRESH_THRESHOLD_MS) return stored;

    try {
        return await refreshJwt(stored.jwt);
    } catch (e) {
        console.warn('[auth] Refresh failed, using existing JWT until expiry:', e.message);
        return stored;
    }
}

module.exports = {
    DEVICE_TYPE,
    readStoredJwt,
    writeStoredJwt,
    clearStoredJwt,
    getOrCreateServiceToken,
    createDeviceCode,
    pollDeviceCode,
    refreshJwt,
    getValidJwt,
};
