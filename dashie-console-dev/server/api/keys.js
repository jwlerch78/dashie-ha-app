// server/api/keys.js
// Console-facing endpoints for add-on-local BYO API keys (Open Brain plan
// 20260710_OPEN_BRAIN_BYOK_PRESETS_UI.md §4). Mirrors api/settings.js:
// ingress-protected reads; writes additionally require the add-on to be
// signed into a Dashie account.
//
//   GET /api/keys         → masked per-provider view (for the console UI)
//   PUT /api/keys         → { provider, value } — set or clear (value: null)
//   GET /api/keys/status  → booleans only (which providers are configured);
//                           the device reads this to route the brain (Phase 2)

const express = require('express');
const auth = require('../auth');
const keyStore = require('../key-store');
const providers = require('../brain/providers');

const router = express.Router();

function requireSignedIn(req, res, next) {
    const stored = auth.readStoredJwt();
    if (!stored) {
        return res.status(401).json({ error: 'add_on_not_signed_in' });
    }
    next();
}

/** GET /api/keys → masked values + set flags. Full keys never leave the box. */
router.get('/', (req, res) => {
    res.json({ providers: keyStore.maskedKeys() });
});

/** GET /api/keys/status → { gemini: bool, claude: bool, ... } */
router.get('/status', (req, res) => {
    res.json({ providers: keyStore.status() });
});

/**
 * POST /api/keys/validate  { provider }
 * Free "is my key valid?" check — a GET to the provider's /models endpoint (no
 * completion, nothing billed). → { ok: true|false|null, detail }.
 */
router.post('/validate', express.json(), async (req, res) => {
    const { provider } = req.body || {};
    if (!keyStore.isKnownProvider(provider)) {
        return res.status(400).json({ error: 'unknown_provider' });
    }
    try {
        const result = await providers.validateProvider(provider);
        res.json(result);
    } catch (e) {
        console.error('[keys] validate failed:', e.message);
        res.json({ ok: false, detail: 'Validation failed to run.' });
    }
});

/**
 * PUT /api/keys  { provider: 'gemini', value: { key: '...' } }
 * Bedrock: value = { accessKeyId, secretAccessKey, region }.
 * value: null clears the provider. Responds with the new masked view.
 */
router.put('/', requireSignedIn, express.json(), (req, res) => {
    const { provider, value } = req.body || {};
    if (!keyStore.isKnownProvider(provider)) {
        return res.status(400).json({ error: 'unknown_provider' });
    }
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
        return res.status(400).json({ error: 'bad_value' });
    }
    try {
        keyStore.writeProvider(provider, value);
        console.log(`[keys] ${provider} → ${keyStore.status()[provider] ? 'set' : 'cleared'}`);
    } catch (e) {
        console.error('[keys] write failed:', e.message);
        return res.status(500).json({ error: 'write_failed' });
    }
    res.json({ providers: keyStore.maskedKeys() });
});

module.exports = router;
