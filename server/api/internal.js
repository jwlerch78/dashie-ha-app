// server/api/internal.js
//
// Endpoints for trusted in-HA callers (the Dashie integration), reached over the
// hassio Docker network. The add-on is ingress-only (no external ports), so these
// are not reachable from outside HA.
//
// ⚠️ v1 SECURITY = network-trust only. Any component on the hassio network can call
// this and obtain the account JWT. Acceptable for single-household dev; HARDEN before
// wider use — a shared secret (config_flow option ↔ add-on option) or a short-lived
// scoped token. Tracked in tech-debt.
//
// The account credential is only vended when the account holder has opted into
// household-wide Dashie Cloud sharing (settings-store). When off, anonymous
// tablets/satellites fall back to local voice — the credential never leaves.

const express = require('express');
const auth = require('../auth');
const settingsStore = require('../settings-store');

const router = express.Router();

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

module.exports = router;
