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

/**
 * Map of Console-side "role" names to (entity_id suffix, domain, on/off services).
 * The Console doesn't need to know HA's entity_id naming or service names — it
 * just sends `{ device_id, role, value }` and the add-on resolves to a
 * `<domain>.<slug>_<entitySuffix>` entity_id and the appropriate service.
 *
 * For numeric entities (volume, brightness), we use number.set_value with `value` as service_data.
 * For switches, value is boolean → switch.turn_on / switch.turn_off.
 * For buttons (reload, refresh), value is ignored → button.press.
 */
const CONTROL_MAP = {
    lock:                    { suffix: 'lock', domain: 'switch', kind: 'switch' },
    screen:                  { suffix: 'screen', domain: 'switch', kind: 'switch' },
    screensaver:             { suffix: 'screensaver', domain: 'switch', kind: 'switch' },
    dark_mode:               { suffix: 'dark_mode', domain: 'switch', kind: 'switch' },
    keep_screen_on:          { suffix: 'keep_screen_on', domain: 'switch', kind: 'switch' },
    auto_brightness:         { suffix: 'auto_brightness', domain: 'switch', kind: 'switch' },
    hide_sidebar:            { suffix: 'hide_sidebar', domain: 'switch', kind: 'switch' },
    hide_tabs:               { suffix: 'hide_tabs', domain: 'switch', kind: 'switch' },
    start_on_boot:           { suffix: 'start_on_boot', domain: 'switch', kind: 'switch' },
    camera_stream_enabled:   { suffix: 'camera_stream_enabled', domain: 'switch', kind: 'switch' },
    camera_software_encoding:{ suffix: 'camera_software_encoding', domain: 'switch', kind: 'switch' },
    volume:                  { suffix: 'volume', domain: 'number', kind: 'number' },
    brightness:              { suffix: 'brightness', domain: 'number', kind: 'number' },
    zoom:                    { suffix: 'zoom', domain: 'number', kind: 'number' },
    reload:                  { suffix: 'reload_dashboard', domain: 'button', kind: 'button' },
    relaunch:                { suffix: 'restart_app', domain: 'button', kind: 'button' },
    refresh:                 { suffix: 'refresh_webview', domain: 'button', kind: 'button' },
    bring_to_foreground:     { suffix: 'bring_to_foreground', domain: 'button', kind: 'button' },
    reboot:                  { suffix: 'reboot_device', domain: 'button', kind: 'button' },
    clear_cache:             { suffix: 'clear_cache', domain: 'button', kind: 'button' },
    clear_storage:           { suffix: 'clear_storage', domain: 'button', kind: 'button' },
};

/**
 * POST /api/ha/control
 * Body: { device_id: '<dashie hex>', role: 'lock'|'volume'|..., value: bool|number }
 * Translates to a HA service call. Console doesn't need to know HA naming.
 */
router.post('/control', requireSignedIn, express.json(), async (req, res) => {
    const { device_id, role, value } = req.body || {};
    if (!device_id) return res.status(400).json({ error: 'device_id required' });
    if (!role) return res.status(400).json({ error: 'role required' });
    const map = CONTROL_MAP[role];
    if (!map) return res.status(400).json({ error: `unknown role: ${role}` });

    const slug = haWorker.getSlugForDevice(device_id);
    if (!slug) return res.status(404).json({ error: 'device_not_found_or_offline' });
    const entityId = `${map.domain}.${slug}_${map.suffix}`;

    try {
        let serviceName, serviceData = {};
        if (map.kind === 'switch') {
            serviceName = value ? 'turn_on' : 'turn_off';
        } else if (map.kind === 'number') {
            const num = Number(value);
            if (!Number.isFinite(num)) return res.status(400).json({ error: 'value must be numeric' });
            serviceName = 'set_value';
            serviceData.value = num;
        } else if (map.kind === 'button') {
            serviceName = 'press';
        } else {
            return res.status(500).json({ error: 'unsupported control kind' });
        }

        await haRegistry.callService(map.domain, serviceName, entityId, serviceData);
        // Trigger a poll so the next /api/ha/status reflects the new state.
        haWorker.triggerRefresh(`post-${role}`);
        res.json({ success: true, entity_id: entityId, service: `${map.domain}.${serviceName}` });
    } catch (e) {
        console.warn(`[api/ha] Control ${role}=${value} failed for ${device_id}: ${e.message}`);
        res.status(500).json({ error: 'ha_control_failed', message: e.message });
    }
});

/**
 * GET /api/ha/image/:deviceId/:role
 * Proxies HA's image_proxy / camera_proxy so the Console can render the latest
 * screenshot or camera snapshot via a same-origin <img>. role = 'screenshot' | 'camera'.
 *
 * Uses the entity_registry to find the right entity for this device, since
 * legacy installs (Fire Tablet → image.dashie_fire_tablet, Mio → image.mio_15_dashie)
 * don't follow the modern <slug>_<role> entity-id convention.
 */
const haClient = require('../ha-client');
async function findMediaEntity(dashieDeviceId, role) {
    const entry = await haRegistry.getDeviceByDashieId(dashieDeviceId);
    if (!entry) return null;
    const allEntities = await haRegistry.getEntitiesForHaDevice(entry.id);
    const targetDomain = role === 'screenshot' ? 'image' : 'camera';
    const candidates = allEntities.filter(e => (e.entity_id || '').startsWith(targetDomain + '.'));
    for (const c of candidates) {
        const state = await haClient.getState(c.entity_id);
        if (state?.attributes?.entity_picture) return state;
    }
    // Fallback: state without entity_picture (e.g. recently-added entity); return first
    if (candidates.length > 0) {
        return await haClient.getState(candidates[0].entity_id);
    }
    return null;
}

router.get('/image/:deviceId/:role', requireSignedIn, async (req, res) => {
    const { deviceId, role } = req.params;
    if (role !== 'screenshot' && role !== 'camera') {
        return res.status(400).json({ error: 'unknown role (screenshot|camera)' });
    }
    try {
        const state = await findMediaEntity(deviceId, role);
        if (!state) return res.status(404).json({ error: `no ${role} entity found for device` });
        const entityPicture = state.attributes?.entity_picture;
        if (!entityPicture) return res.status(404).json({ error: 'entity has no entity_picture yet' });

        const config = haClient.getConfig();
        const fullUrl = entityPicture.startsWith('http')
            ? entityPicture
            : config.baseUrl + entityPicture;
        const upstream = await fetch(fullUrl, {
            headers: { Authorization: `Bearer ${config.token}` },
        });
        if (!upstream.ok) {
            return res.status(502).json({ error: `HA returned ${upstream.status}` });
        }
        const ctype = upstream.headers.get('content-type') || 'image/jpeg';
        res.set('Content-Type', ctype);
        res.set('Cache-Control', 'no-cache, max-age=5');
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.send(buf);
    } catch (e) {
        console.warn(`[api/ha/image] ${deviceId}/${role} failed: ${e.message}`);
        res.status(500).json({ error: 'proxy_failed', message: e.message });
    }
});

/**
 * GET /api/ha/stream/:deviceId
 * Returns the HLS playlist URL for the device's camera entity. HA's `camera/stream`
 * WS request kicks off the stream pipeline (RTSP → HLS via the stream component);
 * Console then plays it via hls.js / native HLS in a <video> element.
 *
 * Same source HA's more-info dialog uses, so what we render matches what HA shows.
 */
router.get('/stream/:deviceId', requireSignedIn, async (req, res) => {
    const { deviceId } = req.params;
    try {
        const state = await findMediaEntity(deviceId, 'camera');
        if (!state) return res.status(404).json({ error: 'no camera entity for device' });
        const result = await haRegistry.getCameraStreamUrl(state.entity_id);
        if (!result?.url) return res.status(502).json({ error: 'HA did not return a stream URL' });
        // Rewrite HA's HLS URL through our /api/ha/hls proxy so the browser hits
        // the add-on (which controls Content-Encoding) instead of going via Ingress
        // (where compression negotiation has caused ERR_CONTENT_DECODING_FAILED).
        const proxiedUrl = 'api/ha/hls?u=' + encodeURIComponent(result.url);
        res.json({ entity_id: state.entity_id, hls_url: proxiedUrl, poster: state.attributes?.entity_picture || null });
    } catch (e) {
        console.warn(`[api/ha/stream] ${deviceId} failed: ${e.message}`);
        res.status(500).json({ error: 'stream_resolve_failed', message: e.message });
    }
});

/**
 * GET /api/ha/hls?u=/api/hls/<token>/master_playlist.m3u8
 * Fetches an HA HLS resource (manifest or .ts segment) from the supervisor
 * URL and pipes the bytes back. Forces uncompressed transport so the browser
 * doesn't hit ERR_CONTENT_DECODING_FAILED (seen in some Ingress configs).
 *
 * Manifests reference relative paths (e.g. `playlist.m3u8`, `segment_5.ts`).
 * For nested fetches, hls.js resolves them relative to the manifest URL —
 * our proxy URL `/api/ha/hls?u=...` doesn't have a directory structure, so we
 * rewrite manifest contents to keep all references going through our proxy.
 */
router.get('/hls', requireSignedIn, async (req, res) => {
    const haPath = req.query.u;
    if (typeof haPath !== 'string' || !haPath.startsWith('/api/hls/')) {
        return res.status(400).json({ error: 'bad u param' });
    }
    const config = haClient.getConfig();
    try {
        const upstream = await fetch(config.baseUrl + haPath, {
            headers: { Authorization: `Bearer ${config.token}` },
        });
        if (!upstream.ok) {
            return res.status(upstream.status).json({ error: `HA returned ${upstream.status}` });
        }
        const ctype = upstream.headers.get('content-type') || 'application/octet-stream';
        res.removeHeader && res.removeHeader('Content-Encoding');
        res.set('Content-Type', ctype);
        res.set('Cache-Control', 'no-cache');

        if (ctype.includes('mpegurl') || ctype.includes('m3u8') || haPath.endsWith('.m3u8')) {
            // Rewrite playlist references so each .ts segment / nested .m3u8 / init.mp4
            // also routes through this proxy with the right `u=` path. Two cases:
            //   1) Bare relative URL line (segment_5.ts, playlist.m3u8)
            //   2) Directive lines with URI="..." (#EXT-X-MAP:URI="init.mp4",
            //      #EXT-X-KEY:URI="key.bin"). These start with '#' but still need
            //      their inner URIs rewritten.
            const txt = await upstream.text();
            const baseDir = haPath.replace(/[^/]+$/, '');  // /api/hls/<token>/
            const rewriteRef = ref => {
                if (!ref) return ref;
                const abs = ref.startsWith('/') ? ref : (baseDir + ref);
                return 'hls?u=' + encodeURIComponent(abs);
            };
            const rewritten = txt.split('\n').map(line => {
                const trim = line.trim();
                if (!trim) return line;
                if (trim.startsWith('#')) {
                    // Rewrite any URI="..." inside directives.
                    return line.replace(/URI="([^"]+)"/g, (_m, ref) => `URI="${rewriteRef(ref)}"`);
                }
                return rewriteRef(trim);
            }).join('\n');
            res.send(rewritten);
        } else {
            const buf = Buffer.from(await upstream.arrayBuffer());
            res.send(buf);
        }
    } catch (e) {
        console.warn(`[api/ha/hls] ${haPath} failed: ${e.message}`);
        res.status(500).json({ error: 'hls_proxy_failed', message: e.message });
    }
});

/**
 * GET /api/ha/events
 * Server-Sent Events stream of HA state_changed events filtered to Dashie-integration
 * entities. Each event is enriched with {device_id, role, state, attributes} so the
 * Console doesn't need entity_registry knowledge to react to a change.
 *
 * Same data HA's own UI gets via WebSocket — pushed in real time (~50–200ms latency).
 */
const sseClients = new Set();
let sseUnsubscribe = null;

async function _ensureStateChangedFanout() {
    if (sseUnsubscribe) return;
    sseUnsubscribe = await haRegistry.subscribeStateChanged(async (event) => {
        const data = event?.data;
        if (!data?.entity_id || !data?.new_state) return;
        // Resolve to a Dashie device + role using cached entity_registry.
        try {
            const entities = await haRegistry.getAllEntities();
            const entry = entities.find(e => e.entity_id === data.entity_id);
            if (!entry?.device_id) return;
            // Find the dashie device_id from the HA device's identifiers tuple.
            const allDashieIds = haWorker.getStatus().lastRun?.freshDevices?.map(d => d.device_id) || [];
            let dashieId = null;
            for (const id of allDashieIds) {
                const dev = await haRegistry.getDeviceByDashieId(id);
                if (dev?.id === entry.device_id) { dashieId = id; break; }
            }
            if (!dashieId) return;
            // Role from unique_id ({dashieId}_{role}) — falls back to entity_id suffix.
            let role = null;
            if (entry.unique_id?.startsWith(dashieId + '_')) role = entry.unique_id.slice(dashieId.length + 1);
            const payload = JSON.stringify({
                type: 'state',
                device_id: dashieId,
                role,
                entity_id: data.entity_id,
                state: data.new_state.state,
                attributes: data.new_state.attributes,
            });
            for (const res of sseClients) {
                try { res.write(`data: ${payload}\n\n`); } catch {}
            }
        } catch (e) {
            console.warn('[api/ha/events] event enrich failed:', e.message);
        }
    });
}

router.get('/events', requireSignedIn, async (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write(': connected\n\n');
    sseClients.add(res);
    try { await _ensureStateChangedFanout(); }
    catch (e) { console.warn('[api/ha/events] subscribe failed:', e.message); }

    const heartbeat = setInterval(() => {
        try { res.write(': hb\n\n'); } catch { clearInterval(heartbeat); }
    }, 25 * 1000);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
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
