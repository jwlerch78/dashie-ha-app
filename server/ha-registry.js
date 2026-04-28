// server/ha-registry.js
// Thin HA WebSocket client for reading + updating the device_registry.
//
// Why WebSocket and not REST: HA's device_registry isn't fully exposed via REST.
// The `config/device_registry/list` and `config/device_registry/update` endpoints
// only exist on the WebSocket API.
//
// Auto-detects supervisor vs local-LLAT mode (same env vars as ha-client.js).
//
// Public surface:
//   getDeviceByDashieId(dashieDeviceId) → registry entry (or null) — cached
//   renameDevice(dashieDeviceId, newName) → success bool, sets `name_by_user`
//   refresh()  → re-pull the device list, invalidate cache
//   isAvailable() → can we even talk to HA right now
//
// Tolerant: throws on hard errors but the worker callers should catch and log;
// the worker keeps polling regardless.

const WebSocket = require('ws');

const REQUEST_TIMEOUT_MS = 8000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

let ws = null;
let connectionPromise = null;       // resolves when authed; rejects on auth fail
let nextMsgId = 1;
const pending = new Map();          // id → { resolve, reject, timer }
const eventHandlers = new Map();    // subscription id → handler(eventBody)
const stateChangeListeners = new Set();
let stateChangedSubId = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let registryCache = null;           // { byDashieId: Map, byHaId: Map, fetchedAt }
let entityRegistryCache = null;     // { byHaDeviceId: Map<haDeviceId, entity[]>, fetchedAt }
let stopped = false;

function getWsConfig() {
    if (process.env.SUPERVISOR_TOKEN) {
        return {
            url: 'ws://supervisor/core/api/websocket',
            token: process.env.SUPERVISOR_TOKEN,
            mode: 'supervisor',
        };
    }
    if (process.env.DASHIE_HA_URL && process.env.DASHIE_HA_TOKEN) {
        const wsUrl = process.env.DASHIE_HA_URL
            .replace(/\/$/, '')
            .replace(/^https?:/, m => m === 'https:' ? 'wss:' : 'ws:')
            + '/api/websocket';
        return {
            url: wsUrl,
            token: process.env.DASHIE_HA_TOKEN,
            mode: 'dev-llat',
        };
    }
    return null;
}

function isAvailable() {
    return getWsConfig() !== null;
}

function _connect() {
    if (connectionPromise) return connectionPromise;
    const config = getWsConfig();
    if (!config) return Promise.reject(new Error('HA WS not configured'));

    connectionPromise = new Promise((resolve, reject) => {
        let authResolved = false;
        const sock = new WebSocket(config.url);
        ws = sock;

        sock.on('open', () => {
            // HA sends `auth_required` first; we'll respond on first message.
        });

        sock.on('message', (raw) => {
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch { return; }

            if (msg.type === 'auth_required') {
                sock.send(JSON.stringify({ type: 'auth', access_token: config.token }));
                return;
            }
            if (msg.type === 'auth_ok') {
                authResolved = true;
                reconnectAttempts = 0;
                console.log(`[ha-registry] WebSocket authed (${config.mode})`);
                resolve();
                return;
            }
            if (msg.type === 'auth_invalid') {
                authResolved = true;
                reject(new Error('HA WS auth_invalid: ' + (msg.message || 'token rejected')));
                sock.close();
                return;
            }
            // Subscribed events arrive as type:'event' with the original subscribe id.
            if (msg.type === 'event' && msg.id != null && eventHandlers.has(msg.id)) {
                const handler = eventHandlers.get(msg.id);
                try { handler(msg.event); } catch (e) { console.warn('[ha-registry] event handler threw:', e.message); }
                return;
            }
            if (msg.id != null && pending.has(msg.id)) {
                const { resolve: r, reject: rj, timer } = pending.get(msg.id);
                clearTimeout(timer);
                pending.delete(msg.id);
                if (msg.type === 'result') {
                    if (msg.success) r(msg.result);
                    else rj(new Error(msg.error?.message || 'HA WS command failed'));
                } else {
                    // event/other types: shouldn't happen for our commands
                    r(msg);
                }
            }
        });

        sock.on('close', () => {
            ws = null;
            connectionPromise = null;
            // Reject any in-flight commands
            for (const [, { reject: rj, timer }] of pending) {
                clearTimeout(timer);
                rj(new Error('HA WS closed'));
            }
            pending.clear();
            // Drop the subscription id so listeners get re-subscribed on next connect.
            if (stateChangedSubId !== null) eventHandlers.delete(stateChangedSubId);
            stateChangedSubId = null;
            if (!authResolved) reject(new Error('HA WS closed before auth'));
            if (!stopped) {
                _scheduleReconnect();
                // After reconnect, re-establish state_changed subscription if anyone wants it.
                if (stateChangeListeners.size > 0) {
                    setTimeout(() => _ensureStateChangedSubscription().catch(() => {}), 3000);
                }
            }
        });

        sock.on('error', (err) => {
            console.warn('[ha-registry] WS error:', err.message);
            if (!authResolved) reject(err);
        });
    }).catch(e => {
        // Reset for retry. Caller sees the rejection.
        connectionPromise = null;
        throw e;
    });

    return connectionPromise;
}

function _scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
    reconnectAttempts++;
    console.log(`[ha-registry] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        _connect().catch(() => { /* will reschedule via close */ });
    }, delay);
    if (reconnectTimer.unref) reconnectTimer.unref();
}

function _send(payload) {
    return _connect().then(() => new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return reject(new Error('HA WS not open'));
        }
        const id = nextMsgId++;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`HA WS request ${id} timed out`));
        }, REQUEST_TIMEOUT_MS);
        if (timer.unref) timer.unref();
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, ...payload }));
    }));
}

async function _refreshRegistryCache() {
    const list = await _send({ type: 'config/device_registry/list' });
    const byDashieId = new Map();
    const byHaId = new Map();
    for (const entry of list) {
        byHaId.set(entry.id, entry);
        // identifiers is an array of [domain, id] tuples; the Dashie integration
        // uses domain "dashie" with the device_id as the second element.
        for (const ident of entry.identifiers || []) {
            if (Array.isArray(ident) && ident[0] === 'dashie' && ident[1]) {
                byDashieId.set(ident[1], entry);
            }
        }
    }
    registryCache = { byDashieId, byHaId, fetchedAt: Date.now() };
    return registryCache;
}

/** Returns the registry entry (with id, name, name_by_user, identifiers, ...) or null. */
async function getDeviceByDashieId(dashieDeviceId, { force = false } = {}) {
    if (!dashieDeviceId) return null;
    if (force || !registryCache) await _refreshRegistryCache();
    let entry = registryCache.byDashieId.get(dashieDeviceId);
    if (!entry && !force) {
        // Stale cache (device was just added/migrated) — refresh once and retry
        await _refreshRegistryCache();
        entry = registryCache.byDashieId.get(dashieDeviceId);
    }
    return entry || null;
}

/**
 * Set the user-facing name (`name_by_user`) for the device matching this Dashie
 * device_id. Returns the updated registry entry, or throws on failure.
 */
async function renameDevice(dashieDeviceId, newName) {
    const entry = await getDeviceByDashieId(dashieDeviceId);
    if (!entry) {
        throw new Error(`No HA device_registry entry found for Dashie device_id ${dashieDeviceId}`);
    }
    const updated = await _send({
        type: 'config/device_registry/update',
        device_id: entry.id,
        name_by_user: newName,
    });
    // Invalidate so subsequent reads see the new name.
    registryCache = null;
    return updated;
}

/**
 * Subscribe to HA's state_changed events. The first call sends the actual WS
 * subscribe message; subsequent callers piggyback on the same subscription.
 * Returns an unsubscribe function for the caller's slot.
 *
 * Re-establishes the subscription automatically after a WS reconnect, so
 * callers don't need to re-subscribe.
 */
async function subscribeStateChanged(callback) {
    stateChangeListeners.add(callback);
    await _ensureStateChangedSubscription();
    return () => stateChangeListeners.delete(callback);
}

async function _ensureStateChangedSubscription() {
    if (stateChangedSubId !== null) return;
    await _connect();
    const id = nextMsgId++;
    stateChangedSubId = id;
    eventHandlers.set(id, (event) => {
        for (const cb of stateChangeListeners) {
            try { cb(event); } catch (e) { console.warn('[ha-registry] listener threw:', e.message); }
        }
    });
    ws.send(JSON.stringify({ id, type: 'subscribe_events', event_type: 'state_changed' }));
}

/**
 * Get the HLS playlist URL for a camera entity. HA spins up its stream
 * pipeline (RTSP → HLS via the `stream` integration) and returns a
 * session URL like /api/hls/<token>/master_playlist.m3u8. This is the
 * same call HA's own more-info dialog makes for the camera player.
 */
async function getCameraStreamUrl(entityId, format = 'hls') {
    return _send({ type: 'camera/stream', entity_id: entityId, format });
}

/**
 * Call an HA service (switch.turn_on, number.set_value, button.press, etc.)
 * targeting a specific entity. Returns whatever HA echoes back.
 */
async function callService(domain, service, entityId, serviceData = {}) {
    if (!domain || !service || !entityId) {
        throw new Error('callService requires domain, service, entity_id');
    }
    return _send({
        type: 'call_service',
        domain,
        service,
        target: { entity_id: entityId },
        service_data: serviceData,
    });
}

/** Force a re-pull of the device registry (e.g., after we know HA changed). */
function refresh() {
    registryCache = null;
    entityRegistryCache = null;
}

/** Fetch + cache HA's entity_registry. Used to find image/camera entities
 *  for a device whose entity_ids don't follow the slug_<role> convention
 *  (Fire Tablet, Mio, etc. have legacy entity names). */
async function _refreshEntityRegistryCache() {
    const list = await _send({ type: 'config/entity_registry/list' });
    const byHaDeviceId = new Map();
    for (const e of list) {
        if (!e.device_id) continue;
        const arr = byHaDeviceId.get(e.device_id) || [];
        arr.push(e);
        byHaDeviceId.set(e.device_id, arr);
    }
    entityRegistryCache = { byHaDeviceId, fetchedAt: Date.now() };
    return entityRegistryCache;
}

/** Returns all entity_registry entries for a HA device id. */
async function getEntitiesForHaDevice(haDeviceId, { force = false } = {}) {
    if (!haDeviceId) return [];
    if (force || !entityRegistryCache) await _refreshEntityRegistryCache();
    let entities = entityRegistryCache.byHaDeviceId.get(haDeviceId) || [];
    if (entities.length === 0 && !force) {
        await _refreshEntityRegistryCache();
        entities = entityRegistryCache.byHaDeviceId.get(haDeviceId) || [];
    }
    return entities;
}

/** Returns the full HA entity_registry as a flat array (cached). Used by the
 *  worker to build a per-device metrics view without slug-based heuristics. */
async function getAllEntities({ force = false } = {}) {
    if (force || !entityRegistryCache) await _refreshEntityRegistryCache();
    const all = [];
    for (const arr of entityRegistryCache.byHaDeviceId.values()) all.push(...arr);
    return all;
}

function start() {
    if (!isAvailable()) {
        console.log('[ha-registry] Not configured (no SUPERVISOR_TOKEN or DASHIE_HA_URL+TOKEN); rename will be unavailable.');
        return;
    }
    stopped = false;
    _connect().catch(e => console.warn('[ha-registry] Initial connect failed:', e.message));
}

function stop() {
    stopped = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { try { ws.close(); } catch {} }
    ws = null;
    connectionPromise = null;
}

module.exports = {
    isAvailable,
    start,
    stop,
    getDeviceByDashieId,
    getEntitiesForHaDevice,
    getAllEntities,
    getCameraStreamUrl,
    subscribeStateChanged,
    renameDevice,
    callService,
    refresh,
};
