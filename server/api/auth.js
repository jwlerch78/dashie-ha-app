// server/api/auth.js
// Auth API endpoints for the frontend.

const express = require('express');
const auth = require('../auth');
const { SUPABASE, SUPABASE_ENV } = require('../config');

const router = express.Router();

/**
 * GET /api/auth/status
 * Returns current auth state. Frontend uses this on boot to decide login screen vs app.
 */
router.get('/status', async (req, res) => {
    const stored = auth.readStoredJwt();
    if (!stored) {
        return res.json({
            authenticated: false,
            supabase_env: SUPABASE_ENV,
            supabase_url: SUPABASE.url,
            supabase_anon_key: SUPABASE.anonKey,
            google_client_id: SUPABASE.googleClientId,
        });
    }
    return res.json({
        authenticated: true,
        user_id: stored.userId,
        user_email: stored.userEmail,
        jwt_expires_at: stored.expiry ? new Date(stored.expiry).toISOString() : null,
        // The frontend still needs these to call Supabase directly for non-broker flows
        supabase_env: SUPABASE_ENV,
        supabase_url: SUPABASE.url,
        supabase_anon_key: SUPABASE.anonKey,
        google_client_id: SUPABASE.googleClientId,
    });
});

/**
 * POST /api/auth/exchange
 * Body: { code, redirect_uri }
 * Exchanges the OAuth code for Google tokens, then bootstraps a Dashie JWT.
 * Stores server-side. Returns authenticated-user info (not the JWT — frontend doesn't need it).
 */
router.post('/exchange', express.json(), async (req, res) => {
    const { code, redirect_uri } = req.body || {};
    if (!code || !redirect_uri) {
        return res.status(400).json({ error: 'missing_params', message: 'code and redirect_uri required' });
    }
    try {
        const googleTokens = await auth.exchangeOAuthCode(code, redirect_uri);
        const { jwt, user } = await auth.bootstrapJwt(googleTokens.access_token);
        const stored = auth.writeStoredJwtFromToken(jwt);
        return res.json({
            authenticated: true,
            user_id: stored.userId,
            user_email: stored.userEmail,
            user_name: user?.name || null,
        });
    } catch (e) {
        console.error('[auth/exchange]', e);
        return res.status(500).json({ error: 'exchange_failed', message: e.message });
    }
});

/**
 * GET /api/auth/jwt
 * Returns the stored JWT to the frontend — so the frontend can call Supabase edge functions
 * directly (keeps all the existing dashie-console code working unchanged, just fetches the
 * JWT from here instead of local OAuth).
 * Refreshes if within the threshold window.
 *
 * Security note: this endpoint is served inside HA's Ingress or on localhost, so the JWT
 * never leaves the HA network perimeter in an unsafe way.
 */
router.get('/jwt', async (req, res) => {
    try {
        const stored = await auth.getValidJwt();
        return res.json({
            jwt: stored.jwt,
            user_id: stored.userId,
            user_email: stored.userEmail,
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
router.post('/sign-out', async (req, res) => {
    auth.clearStoredJwt();
    return res.json({ success: true });
});

/**
 * GET /api/auth/service-token
 * Returns the local service token (UUID) used by HA voice pipeline custom_components
 * to authenticate to this add-on's /api/* endpoints. Not secret within the HA network.
 */
router.get('/service-token', (req, res) => {
    return res.json({ token: auth.getOrCreateServiceToken() });
});

module.exports = router;
