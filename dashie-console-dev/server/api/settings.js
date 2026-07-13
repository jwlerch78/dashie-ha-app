// server/api/settings.js
// Console-facing read/write for add-on-local settings.
//
// Ingress-protected (HA authenticates the user before the request reaches us);
// writes additionally require the add-on to be signed into a Dashie account
// (you can't share an account that isn't there). Mirrors the requireSignedIn
// pattern in api/ha.js / api/feeds.js.

const express = require('express');
const auth = require('../auth');
const settingsStore = require('../settings-store');
const haClient = require('../ha-client');
const accountConfig = require('../account-config');

const router = express.Router();

function requireSignedIn(req, res, next) {
    const stored = auth.readStoredJwt();
    if (!stored) {
        return res.status(401).json({ error: 'add_on_not_signed_in' });
    }
    next();
}

/** GET /api/settings → add-on-local settings, with householdSharing resolved from the
 *  ACCOUNT (voice.householdSharing in user_settings) so any caller sees the truth. */
router.get('/', async (req, res) => {
    let householdSharing = false;
    try {
        const cfg = await accountConfig.getAccountVoiceConfig();
        householdSharing = cfg.householdSharing === true;
    } catch (e) { /* fail closed */ }
    res.json({ ...settingsStore.readSettings(), householdSharing });
});

/**
 * PUT /api/settings/household-sharing  { enabled: bool }
 * Opt this add-on's account into (or out of) household-wide Dashie Cloud sharing.
 */
router.put('/household-sharing', requireSignedIn, express.json(), async (req, res) => {
    const enabled = req.body?.enabled === true;
    // householdSharing is ACCOUNT-scoped now (voice.householdSharing in user_settings) —
    // the CONSOLE writes it (serialized patchUserSetting owns all settings writes; the
    // add-on writing user_settings too would race it). This endpoint's job is to make the
    // change take effect IMMEDIATELY: drop the cached account config (30s TTL) and push a
    // voice-config refresh so anon kiosks re-probe — no reboot/settings/voice needed.
    accountConfig.invalidate();
    console.log(`[settings] household-sharing → ${enabled} (account-scoped; cache invalidated)`);
    if (haClient.isAvailable()) {
        haClient.callService('dashie', 'refresh_voice_config', {}).catch(e =>
            console.warn('[settings] refresh_voice_config push failed (non-fatal):', e.message));
    }
    // Read back from the account so the response reflects what's actually stored.
    let householdSharing = enabled;
    try {
        const cfg = await accountConfig.getAccountVoiceConfig();
        householdSharing = cfg.householdSharing === true;
    } catch (e) { /* fall back to the requested value */ }
    res.json({ householdSharing });
});

module.exports = router;
