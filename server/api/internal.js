// server/api/internal.js
//
// Endpoints for trusted in-HA callers (the Dashie integration), reached over the
// hassio Docker network. The add-on is ingress-only (no external ports), so these
// are not reachable from outside HA.
//
// 🔐 SECURITY (Lever 1): every call must carry the shared bridge secret
// (X-Dashie-Bridge-Secret), checked by the router.use guard below via lib/bridge-auth.
// The secret is provisioned to addon_config so only the Dashie integration can read it.
// Enforced when the `bridge_auth_enforce` add-on option is on (observe-mode logs-but-allows
// until then). Build plan 20260702_BRIDGE_AUTH_HARDENING.md. Follow-up (Lever 2, not built):
// vend a scoped token instead of the raw account JWT.
//
// The account credential is only vended when the account holder has opted into
// household-wide Dashie Cloud sharing (settings-store). When off, anonymous
// tablets/satellites fall back to local voice — the credential never leaves.

const express = require('express');
const auth = require('../auth');
const settingsStore = require('../settings-store');
const { getAccountVoiceConfig } = require('../account-config');
const bridgeAuth = require('../lib/bridge-auth');

const router = express.Router();

// Authenticate every internal call with the shared bridge secret (Lever 1). Observe-mode by
// default (logs would-reject, allows) until `bridge_auth_enforce` is flipped on; then rejects.
// Build plan 20260702_BRIDGE_AUTH_HARDENING.md.
router.use((req, res, next) => {
    if (bridgeAuth.checkRequest(req, res)) next();
});

/**
 * GET /api/internal/sharing-status
 * Cheap capability probe for the integration: is the add-on signed in AND has
 * the account holder enabled household sharing? Drives whether anonymous kiosk
 * tablets may offer "Dashie Cloud". Never returns the credential.
 */
router.get('/sharing-status', (req, res) => {
    const signedIn = !!auth.readStoredJwt();
    const sharing = settingsStore.isHouseholdSharingEnabled();
    const available = signedIn && sharing;
    return res.json({
        available,
        signed_in: signedIn,
        household_sharing: sharing,
        reason: available ? 'ok' : (!signedIn ? 'add_on_not_signed_in' : 'sharing_disabled'),
    });
});

/**
 * GET /api/internal/account-credential
 * Returns the account JWT so the integration can call cloud edge functions
 * (the voice-conversation brain) on the account's behalf. Gated on the
 * household-sharing opt-in.
 */
router.get('/account-credential', async (req, res) => {
    if (!settingsStore.isHouseholdSharingEnabled()) {
        return res.status(403).json({
            error: 'sharing_disabled',
            message: 'Household Dashie Cloud sharing is turned off in the add-on.',
        });
    }
    try {
        const stored = await auth.getValidJwt();
        return res.json({
            jwt: stored.jwt,
            user_id: stored.userId,
            jwt_expires_at: stored.expiry ? new Date(stored.expiry).toISOString() : null,
        });
    } catch (e) {
        return res.status(401).json({ error: 'not_authenticated', message: e.message });
    }
});

/**
 * GET /api/internal/voice-config
 * The account's voice ROUTE for the integration's gateway (M7): 'local' when the account's
 * AI model is "My Local LLM" (ai.model === 'local'), else 'cloud'. The add-on is the single
 * reader of user_settings; the integration uses this to decide cloud-vs-local without reading
 * Supabase itself. No secrets returned (the LAN endpoint stays add-on-side, used in converse-local).
 */
router.get('/voice-config', async (req, res) => {
    try {
        const cfg = await getAccountVoiceConfig();
        return res.json({
            route: cfg.route,
            model_is_local: cfg.route === 'local',
            // Household conversation agent mode (live|dialog|single) for anonymous kiosks —
            // the integration forwards it on /api/dashie/voice/status (Live-on-kiosk, 2026-07-09).
            // '' = unset → the kiosk uses its default.
            agent_mode: cfg.agentMode || '',
        });
    } catch (e) {
        // Never block the gateway on this — default to cloud.
        return res.json({ route: 'cloud', model_is_local: false, agent_mode: '' });
    }
});

module.exports = router;
