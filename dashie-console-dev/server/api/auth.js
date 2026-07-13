// server/api/auth.js
// Auth API endpoints for the frontend (device-flow pattern).

const express = require('express');
const auth = require('../auth');
const haClient = require('../ha-client');
const { SUPABASE, SUPABASE_ENV } = require('../config');

const router = express.Router();

// In-memory device-code state. Only one active link attempt at a time per add-on instance.
// If the user closes the tab or cancels, it sits here until expiry or a new start-link call.
let pendingLink = null;  // { device_code, user_code, verification_url, expires_at }

/**
 * GET /api/auth/status
 * Returns current auth state. Frontend calls on boot to decide login screen vs app.
 */
router.get('/status', async (req, res) => {
    const stored = auth.readStoredJwt();
    const base = {
        supabase_env: SUPABASE_ENV,
        supabase_url: SUPABASE.url,
        supabase_anon_key: SUPABASE.anonKey,
    };
    if (!stored) {
        return res.json({ authenticated: false, ...base });
    }
    return res.json({
        authenticated: true,
        user_id: stored.userId,
        user_email: stored.userEmail,
        user_name: stored.userName || null,
        user_picture: stored.userPicture || null,
        jwt_expires_at: stored.expiry ? new Date(stored.expiry).toISOString() : null,
        ...base,
    });
});

/**
 * POST /api/auth/start-link
 * Creates a new device code via Dashie's jwt-auth edge function and returns the verification
 * URL the frontend should open in a new browser tab.
 */
router.post('/start-link', async (req, res) => {
    try {
        const { device_code, user_code, verification_url, expires_in, interval } =
            await auth.createDeviceCode();
        pendingLink = {
            device_code,
            user_code,
            verification_url,
            expires_at: Date.now() + (expires_in * 1000),
            interval,
        };
        return res.json({
            user_code,
            verification_url,
            expires_at: new Date(pendingLink.expires_at).toISOString(),
            interval,
        });
    } catch (e) {
        console.error('[auth/start-link]', e);
        return res.status(500).json({ error: 'start_link_failed', message: e.message });
    }
});

/**
 * POST /api/auth/poll-link
 * Frontend polls this while the user is in the browser tab completing OAuth.
 * Returns { status: 'pending' | 'authorized' | 'expired' | 'none' }.
 * On 'authorized', the JWT has already been persisted server-side; frontend just needs
 * to flip its UI to signed-in.
 */
router.post('/poll-link', async (req, res) => {
    if (!pendingLink) return res.json({ status: 'none' });
    if (Date.now() >= pendingLink.expires_at) {
        pendingLink = null;
        return res.json({ status: 'expired' });
    }
    try {
        const result = await auth.pollDeviceCode(pendingLink.device_code);
        if (result.status === 'authorized') {
            pendingLink = null;
            // Account CHANGED on this box → push a voice-config refresh, exactly like sign-out
            // does. This is not just a kiosk nicety: the integration caches the account
            // credential (addon_bridge._cache) and, on a cache hit, never re-asks us — so
            // without this push it keeps vending the PREVIOUS account's JWT until that token
            // expires (72h). On 2026-07-13 that had a wiped test account's kiosk minting voice
            // tokens for a deleted user, which failed the credit gate and told the user they
            // were "out of voice credits" while the new account had $2. The service handler
            // clears that cache.
            try {
                if (haClient.isAvailable()) {
                    haClient.callService('dashie', 'refresh_voice_config', {}).catch(() => {});
                }
            } catch (e) {
                console.warn('[auth] sign-in kiosk push failed (non-fatal):', e.message);
            }
            return res.json({
                status: 'authorized',
                user_id: result.jwtStored.userId,
                user_email: result.jwtStored.userEmail,
                user_name: result.jwtStored.userName || null,
                user_picture: result.jwtStored.userPicture || null,
            });
        }
        if (result.status === 'expired') {
            pendingLink = null;
            return res.json({ status: 'expired' });
        }
        return res.json({ status: 'pending' });
    } catch (e) {
        console.error('[auth/poll-link]', e);
        return res.status(500).json({ error: 'poll_failed', message: e.message });
    }
});

/**
 * POST /api/auth/cancel-link
 * User closed the browser tab or cancelled — drop the pending code.
 */
router.post('/cancel-link', (req, res) => {
    pendingLink = null;
    res.json({ success: true });
});

/**
 * GET /api/auth/jwt
 * Returns the stored JWT to the frontend so it can call Supabase edge functions directly.
 * Refreshes automatically if within the refresh threshold.
 */
router.get('/jwt', async (req, res) => {
    try {
        const stored = await auth.getValidJwt();
        return res.json({
            jwt: stored.jwt,
            user_id: stored.userId,
            user_email: stored.userEmail,
            user_name: stored.userName || null,
            user_picture: stored.userPicture || null,
            jwt_expires_at: stored.expiry ? new Date(stored.expiry).toISOString() : null,
        });
    } catch (e) {
        return res.status(401).json({ error: 'not_authenticated', message: e.message });
    }
});

/**
 * POST /api/auth/sign-out
 * Clears the stored JWT.
 */
router.post('/sign-out', (req, res) => {
    auth.clearStoredJwt();
    pendingLink = null;
    // householdSharing is ACCOUNT-scoped (voice.householdSharing in user_settings), so
    // there's nothing instance-local to reset — signing out simply removes the credential,
    // and sharing-status/account-credential fail closed with no account. Still push a
    // voice-config refresh so any anon kiosk re-probes and sees sharing is unavailable.
    try {
        if (haClient.isAvailable()) {
            haClient.callService('dashie', 'refresh_voice_config', {}).catch(() => {});
        }
    } catch (e) {
        console.warn('[auth] sign-out kiosk push failed (non-fatal):', e.message);
    }
    return res.json({ success: true });
});

/**
 * GET /api/auth/service-token
 * Returns the local UUID used by HA voice pipeline custom_components.
 */
router.get('/service-token', (req, res) => {
    return res.json({ token: auth.getOrCreateServiceToken() });
});

module.exports = router;
