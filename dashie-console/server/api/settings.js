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

const router = express.Router();

function requireSignedIn(req, res, next) {
    const stored = auth.readStoredJwt();
    if (!stored) {
        return res.status(401).json({ error: 'add_on_not_signed_in' });
    }
    next();
}

/** GET /api/settings → all add-on-local settings. */
router.get('/', (req, res) => {
    res.json(settingsStore.readSettings());
});

/**
 * PUT /api/settings/household-sharing  { enabled: bool }
 * Opt this add-on's account into (or out of) household-wide Dashie Cloud sharing.
 */
router.put('/household-sharing', requireSignedIn, express.json(), (req, res) => {
    const enabled = req.body?.enabled === true;
    const next = settingsStore.writeSettings({ householdSharing: enabled });
    console.log(`[settings] household-sharing → ${enabled}`);
    res.json({ householdSharing: next.householdSharing });
});

module.exports = router;
