// server/ha-metrics.js
// Pure functions for turning raw HA /api/states output into per-Dashie-device
// metrics JSONB blobs. No I/O — the worker and the test script both import this.
//
// Strategy:
//   1. Find "anchors": every entity matching /_device_id$/ with friendly_name ending
//      " Device ID". Each anchor IS one Dashie device in the HA integration.
//   2. For each anchor derive the slug (e.g. `sensor.fire_tv_device_id` → `fire_tv`).
//   3. Collect all entities across HA domains (sensor, binary_sensor, button, switch,
//      number, select, text, media_player, image, camera) whose name matches
//      `<slug>_<role>` where role is the entity_id suffix (battery, ram_usage, ...).
//   4. Route each matched entity through METRIC_MAP (keyed by role) to build JSONB.
//   5. Sanitize "unavailable"/"unknown" to null.
//
// Why anchor on _device_id instead of friendly_name: the Dashie HA integration does
// NOT put "Dashie" in every device's friendly_name — only some of them do (e.g.,
// "Mio 15\" Dashie"). But every device has a `sensor.<slug>_device_id` — that's the
// reliable integration fingerprint.

// Map entity_id role suffix → JSONB fragment. Deep-merged per device.
// Roles are derived from the entity_id, e.g. `sensor.fire_tv_battery` → "battery".
const METRIC_MAP = {
    'battery':            s => ({ battery: { level: toNum(s.state), plugged: !!s.attributes.plugged } }),
    'plugged_in':         s => ({ battery: {
        charging:    s.state === 'on',
        plug_source: s.attributes.plug_source ?? null,
    }}),
    'ram_usage':          s => ({ system: {
        ram_used_percent: toNum(s.state),
        ram_total_mb:     s.attributes.total_mb ?? null,
        ram_available_mb: s.attributes.available_mb ?? null,
        app_pss_mb:       s.attributes.app_pss_mb ?? null,
    }}),
    'wifi_signal':        s => ({ network: {
        wifi_signal_percent: toNum(s.state),
        wifi_ssid:           s.attributes.ssid ?? null,
        ip_address:          s.attributes.ip_address ?? null,
        mac_address:         s.attributes.mac_address ?? null,
    }}),
    'storage_free':       s => ({ storage: {
        free_gb:  toNum(s.state),
        total_gb: s.attributes.total_gb ?? null,
    }}),
    'android_version':    s => ({ app: {
        android_version:     s.state,
        device_model:        s.attributes.device_model ?? null,
        device_manufacturer: s.attributes.device_manufacturer ?? null,
    }}),
    'app_version':        s => ({ app: {
        app_version:  s.state,
        version_code: s.attributes.version_code ?? null,
    }}),
    'current_page':       s => ({ app: { current_page: s.state } }),
    'screensaver_active': s => ({ screensaver: { active: s.state === 'on' } }),
    'motion_detected':    s => ({ presence: { motion: s.state === 'on' } }),
    'face_detected':      s => ({ presence: { face: s.state === 'on' } }),
    'ambient_light':      s => ({ environment: { ambient_light: toNum(s.state) } }),
    // Toggleable controls (state mirrored so the Console can render their current value)
    'lock':               s => ({ controls: { lock: s.state === 'on' } }),
    'screen':             s => ({ controls: { screen: s.state === 'on' } }),
    'screensaver':        s => ({ controls: { screensaver: s.state === 'on' } }),
    'dark_mode':          s => ({ controls: { dark_mode: s.state === 'on' } }),
    'keep_screen_on':     s => ({ controls: { keep_screen_on: s.state === 'on' } }),
    'auto_brightness':    s => ({ controls: { auto_brightness: s.state === 'on' } }),
    'volume':             s => ({ controls: { volume: toNum(s.state) } }),
    'brightness':         s => ({ controls: { brightness: toNum(s.state) } }),
};

/** Convert HA state string to number; coerce unavailable/unknown/NaN to null. */
function toNum(v) {
    if (v === 'unavailable' || v === 'unknown' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Recursively merge source into target (in place). Arrays are replaced, not merged. */
function deepMerge(target, source) {
    for (const [k, v] of Object.entries(source)) {
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            target[k] = deepMerge(target[k] || {}, v);
        } else {
            target[k] = v;
        }
    }
    return target;
}

/** Walk a metrics object and coerce "unavailable"/"unknown" strings to null. */
function sanitizeMetrics(m) {
    if (m == null) return m;
    if (typeof m === 'string') {
        return (m === 'unavailable' || m === 'unknown') ? null : m;
    }
    if (Array.isArray(m)) return m.map(sanitizeMetrics);
    if (typeof m === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(m)) out[k] = sanitizeMetrics(v);
        return out;
    }
    return m;
}

function hasAnyLiveData(metrics) {
    return metrics.battery?.level != null
        || metrics.system?.ram_used_percent != null
        || metrics.network?.wifi_signal_percent != null
        || metrics.app?.app_version != null;
}

/** Parse "<domain>.<name>" → { domain, name }. Returns null on malformed input. */
function splitEntityId(entityId) {
    const dot = entityId.indexOf('.');
    if (dot < 0) return null;
    return { domain: entityId.slice(0, dot), name: entityId.slice(dot + 1) };
}

/** Every state that has `entity_id.endsWith('_device_id')` AND friendly_name ends
 *  in " Device ID" is a Dashie-integration device anchor. */
function findAnchors(states) {
    return states.filter(s => {
        if (!s.entity_id.endsWith('_device_id')) return false;
        const fn = s.attributes?.friendly_name || '';
        return fn.endsWith(' Device ID') || fn === 'Device ID';
    });
}

/**
 * Turn raw HA /api/states output into an array of per-device records.
 *   [{ deviceName, slug, dashieDeviceId, metrics, entityCount, hasLiveData }, ...]
 *
 * deviceName: the HA device label (anchor's friendly_name minus " Device ID")
 * slug:       e.g. 'fire_tv' — used to group the device's entities
 * dashieDeviceId: 16-hex Android fingerprint, or null if anchor sensor is unavailable
 * metrics:    final JSONB, sanitized
 * entityCount: number of entities matched to this device (for debugging)
 * hasLiveData: true if any key metric (battery/ram/wifi/app) has a non-null value
 */
function buildDeviceMetrics(states) {
    const anchors = findAnchors(states);
    if (anchors.length === 0) return [];

    // Each anchor contributes a slug. Compute them all up front so we can
    // disambiguate cases where one slug is a strict prefix of another
    // (e.g., slug "fire_tv" vs "fire_tv_stick" — we'd want exclusive matching).
    const anchorSlugs = anchors.map(a => {
        const parsed = splitEntityId(a.entity_id);
        const slug = parsed ? parsed.name.replace(/_device_id$/, '') : null;
        return { anchor: a, slug };
    }).filter(x => x.slug);

    const allSlugs = anchorSlugs.map(x => x.slug);

    const results = [];
    for (const { anchor, slug } of anchorSlugs) {
        // Find every longer slug that starts with this slug + '_' (collision guard).
        const longerSlugs = allSlugs.filter(other => other !== slug && other.startsWith(slug + '_'));

        // All entities belonging to this device: entity_id name starts with slug + '_'
        // AND does NOT start with any longer slug + '_'.
        const siblings = states.filter(s => {
            if (s === anchor) return false;
            const parsed = splitEntityId(s.entity_id);
            if (!parsed) return false;
            if (!parsed.name.startsWith(slug + '_')) return false;
            for (const longer of longerSlugs) {
                if (parsed.name.startsWith(longer + '_') || parsed.name === longer) return false;
            }
            return true;
        });

        // Bucket siblings by role (part after slug + '_'). Handle dupes (old + new entities
        // with same role) by preferring the one with a non-unavailable state, tie-break on
        // attribute count.
        const byRole = {};
        for (const s of siblings) {
            const parsed = splitEntityId(s.entity_id);
            const role = parsed.name.slice(slug.length + 1);
            const existing = byRole[role];
            byRole[role] = existing ? pickBetter(existing, s) : s;
        }

        // Apply METRIC_MAP
        let metrics = {};
        for (const [role, extractor] of Object.entries(METRIC_MAP)) {
            const s = byRole[role];
            if (!s) continue;
            metrics = deepMerge(metrics, extractor(s));
        }
        metrics = sanitizeMetrics(metrics);

        const friendlyName = anchor.attributes?.friendly_name || '';
        const deviceName = friendlyName.replace(/ Device ID$/, '').trim() || slug;
        const rawDeviceId = anchor.state;
        const dashieDeviceId = (rawDeviceId === 'unavailable' || rawDeviceId === 'unknown' || !rawDeviceId)
            ? null
            : rawDeviceId;

        results.push({
            deviceName,
            slug,
            dashieDeviceId,
            metrics,
            entityCount: siblings.length,
            hasLiveData: hasAnyLiveData(metrics),
        });
    }
    results.sort((a, b) => a.deviceName.localeCompare(b.deviceName));
    return results;
}

/** Prefer a non-unavailable state; tie-break on attribute count. */
function pickBetter(a, b) {
    const aAvail = a.state !== 'unavailable' && a.state !== 'unknown';
    const bAvail = b.state !== 'unavailable' && b.state !== 'unknown';
    if (aAvail !== bAvail) return aAvail ? a : b;
    return Object.keys(a.attributes || {}).length >= Object.keys(b.attributes || {}).length ? a : b;
}

module.exports = {
    METRIC_MAP,
    findAnchors,
    buildDeviceMetrics,
    pickBetter,
    sanitizeMetrics,
    hasAnyLiveData,
    deepMerge,
};
