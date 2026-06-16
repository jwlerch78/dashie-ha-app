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

const express = require('express');
const auth = require('../auth');

const router = express.Router();

/**
 * GET /api/internal/account-credential
 * Returns the account JWT so the integration can call cloud edge functions
 * (the voice-conversation brain) on the account's behalf.
 */
router.get('/account-credential', async (req, res) => {
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
