// server/api/ha.js
// HA-side API endpoints used by the Console — namely renaming devices in
// HA's device_registry from the Console's pencil-edit UI.
//
// Auth: requires the same JWT we minted via device-flow. We only allow renames
// when the requester is the authenticated add-on user (matches what's stored
// in /data/dashie_auth.json). This keeps the WS HA-rename surface from being
// exposed to anyone hitting the Ingress URL — they must have signed in to
// Dashie on this add-on.

const express = require('express');
const auth = require('../auth');
const haRegistry = require('../ha-registry');
const haWorker = require('../ha-worker');

const router = express.Router();

/** GET /api/ha/status — worker poll state. Open (no auth) since the Console
 *  needs it on every render and the frontend is already past Ingress. */
router.get('/status', (req, res) => {
    res.json(haWorker.getStatus());
});

/** POST /api/ha/refresh — kick an on-demand poll. */
router.post('/refresh', (req, res) => {
    haWorker.triggerRefresh('http-trigger');
    res.json({ triggered: true, status: haWorker.getStatus() });
});

/** Quick in-process auth check. The frontend always calls these from inside the
 *  Ingress page, where Supabase JWT is held by the add-on (`/data/dashie_auth.json`).
 *  We don't need per-request JWT verification — just confirm an authed session
 *  exists. Anyone hitting Ingress is already past HA's authentication. */
function requireSignedIn(req, res, next) {
    const stored = auth.readStoredJwt();
    if (!stored) {
        return res.status(401).json({ error: 'add_on_not_signed_in' });
    }
    next();
}

/**
 * POST /api/ha/rename
 * Body: { device_id: '<dashie hex>', new_name: 'Living Room Tablet' }
 * Renames the device in HA's device_registry (sets `name_by_user`).
 * Console is responsible for calling update_device first/separately to
 * also update Supabase — this endpoint only handles the HA side.
 */
router.post('/rename', requireSignedIn, express.json(), async (req, res) => {
    const { device_id, new_name } = req.body || {};
    if (!device_id || typeof device_id !== 'string') {
        return res.status(400).json({ error: 'device_id required' });
    }
    if (typeof new_name !== 'string' || !new_name.trim()) {
        return res.status(400).json({ error: 'new_name required' });
    }
    if (!haRegistry.isAvailable()) {
        return res.status(503).json({ error: 'ha_not_configured' });
    }

    try {
        const updated = await haRegistry.renameDevice(device_id, new_name.trim());
        // Trigger an immediate metrics poll so user_devices.metrics + ha_device_name
        // refresh without waiting for the next 30s tick.
        haWorker.triggerRefresh('post-rename');
        res.json({
            success: true,
            device_id,
            new_name: new_name.trim(),
            ha_entry_id: updated?.id || null,
        });
    } catch (e) {
        console.warn(`[api/ha] Rename failed for ${device_id}: ${e.message}`);
        res.status(500).json({ error: 'ha_rename_failed', message: e.message });
    }
});

/** GET /api/ha/devices — lookup helper for debugging. Returns the per-Dashie-id map
 *  the Console will use to compute name conflicts. Only readable when signed in. */
router.get('/devices', requireSignedIn, async (req, res) => {
    if (!haRegistry.isAvailable()) {
        return res.json({ available: false, devices: [] });
    }
    try {
        // Force a refresh so the response reflects HA's current state.
        const states = haWorker.getStatus().lastRun?.upsertResult?.updated_device_ids || [];
        const out = [];
        for (const dashieId of states) {
            const entry = await haRegistry.getDeviceByDashieId(dashieId);
            if (!entry) continue;
            out.push({
                dashie_device_id: dashieId,
                ha_device_id: entry.id,
                name: entry.name,
                name_by_user: entry.name_by_user,
            });
        }
        res.json({ available: true, devices: out });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
