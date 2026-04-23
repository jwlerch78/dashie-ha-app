// server/ha-metrics.js
// Pure functions for turning raw HA /api/states output into per-Dashie-tablet
// metrics JSONB blobs. No I/O — the worker and the test script both import this.
//
// Grouping strategy: filter by friendly_name containing "Dashie", then strip a
// known attribute suffix off the end to recover the device name. This avoids
// entity-id slug weirdness (HA splits one tablet across multiple slug prefixes
// like rk3576_u_* and mio_15_dashie_*) because friendly_name stays stable.

// Attribute names the Dashie HA integration exposes (text at the end of
// friendly_name — matches the suffix after the device name).
const DASHIE_ATTRS = [
    'Ambient Light', 'Android Version', 'App Version', 'Auto Brightness',
    'Battery', 'Camera Frame Rate', 'Camera Resolution', 'Camera Stream URL',
    'Camera Software Encoding', 'Clear Cache', 'Clear Storage', 'Current Page',
    'Dark Mode', 'Device Admin', 'Device ID', 'Face Detected', 'Foreground',
    'Bring to Foreground', 'Hide Header', 'Hide Sidebar', 'Keep Screen On',
    'Locked', 'Motion Detected', 'PIN Set', 'Plugged In', 'RAM Usage',
    'Reload', 'Reboot', 'Refresh WebView', 'Restart', 'RTSP Stream',
    'Screen', 'Screensaver', 'Screensaver Active', 'Start on Boot',
    'Storage Free', 'WiFi Signal',
];

// Map each Dashie attribute we care about to a JSONB fragment. The fragments
// are deep-merged per device to build the final metrics object. Unknown-state
// sanitization happens after merging (see sanitizeMetrics below).
const METRIC_MAP = {
    'Battery':           s => ({ battery: { level: toNum(s.state), plugged: !!s.attributes.plugged } }),
    'Plugged In':        s => ({ battery: {
        charging: s.state === 'on',
        plug_source: s.attributes.plug_source ?? null,
    }}),
    'RAM Usage':         s => ({ system: {
        ram_used_percent: toNum(s.state),
        ram_total_mb:     s.attributes.total_mb ?? null,
        ram_available_mb: s.attributes.available_mb ?? null,
        app_pss_mb:       s.attributes.app_pss_mb ?? null,
    }}),
    'WiFi Signal':       s => ({ network: {
        wifi_signal_percent: toNum(s.state),
        wifi_ssid:           s.attributes.ssid ?? null,
        ip_address:          s.attributes.ip_address ?? null,
        mac_address:         s.attributes.mac_address ?? null,
    }}),
    'Storage Free':      s => ({ storage: {
        free_gb:  toNum(s.state),
        total_gb: s.attributes.total_gb ?? null,
    }}),
    'Android Version':   s => ({ app: {
        android_version:      s.state,
        device_model:         s.attributes.device_model ?? null,
        device_manufacturer:  s.attributes.device_manufacturer ?? null,
    }}),
    'App Version':       s => ({ app: {
        app_version:  s.state,
        version_code: s.attributes.version_code ?? null,
    }}),
    'Screensaver Active': s => ({ screensaver: { active: s.state === 'on' } }),
    'Motion Detected':    s => ({ presence: { motion: s.state === 'on' } }),
    'Face Detected':      s => ({ presence: { face: s.state === 'on' } }),
    'Current Page':       s => ({ app: { current_page: s.state } }),
    'Device ID':          s => ({ _dashie_device_id: s.state }),  // extracted + removed before upsert
};

/** Convert HA state string to number, tolerating unavailable/unknown. */
function toNum(v) {
    if (v === 'unavailable' || v === 'unknown' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Given a friendly_name like `Mio 15" Dashie Battery`, return
 *  { deviceName: 'Mio 15" Dashie', attrName: 'Battery' } — or null if no match. */
function parseDashieFriendly(friendlyName) {
    if (!friendlyName || !friendlyName.toLowerCase().includes('dashie')) return null;
    // Longest suffix wins so "Camera Stream URL" beats "URL" if we ever add one.
    const match = DASHIE_ATTRS
        .filter(a => friendlyName.endsWith(' ' + a))
        .sort((x, y) => y.length - x.length)[0];
    if (!match) return null;
    return {
        deviceName: friendlyName.slice(0, -(match.length + 1)).trim(),
        attrName: match,
    };
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

/** HA exposes duplicate entities per sensor (old slug + new device_id slug) under the same
 *  friendly_name. Pick the "best" of the two: non-unavailable wins; tie-break on attr count. */
function pickBetter(a, b) {
    const aAvail = a.state !== 'unavailable' && a.state !== 'unknown';
    const bAvail = b.state !== 'unavailable' && b.state !== 'unknown';
    if (aAvail !== bAvail) return aAvail ? a : b;
    return Object.keys(a.attributes || {}).length >= Object.keys(b.attributes || {}).length ? a : b;
}

/** Walk a metrics object and coerce string "unavailable"/"unknown" to null. */
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

/** Decide whether a device has any real data. If everything is null/false/empty we should
 *  still upsert (it tells the console the device is known-but-offline), but the caller may
 *  want to know. */
function hasAnyLiveData(metrics) {
    const battery = metrics.battery?.level != null;
    const ram = metrics.system?.ram_used_percent != null;
    const wifi = metrics.network?.wifi_signal_percent != null;
    const app = metrics.app?.app_version != null;
    return battery || ram || wifi || app;
}

/**
 * Turn raw HA /api/states output into an array of per-device records:
 *   [{ deviceName, dashieDeviceId, metrics, entityCount, hasLiveData }, ...]
 *
 * - deviceName: e.g. 'Mio 15" Dashie'
 * - dashieDeviceId: contents of the _device_id sensor state (used to match Android-registered
 *   user_devices.device_id), or null if sensor is unavailable/missing.
 * - metrics: final JSONB blob, sanitized (no 'unavailable' strings).
 * - entityCount: number of Dashie entities matched for the device — useful for debugging.
 * - hasLiveData: heuristic for "did we get anything useful this poll?"
 */
function buildDeviceMetrics(states) {
    const byDevice = {};
    for (const s of states) {
        const parsed = parseDashieFriendly(s.attributes?.friendly_name);
        if (!parsed) continue;
        byDevice[parsed.deviceName] ??= {};
        const existing = byDevice[parsed.deviceName][parsed.attrName];
        byDevice[parsed.deviceName][parsed.attrName] = existing ? pickBetter(existing, s) : s;
    }

    const results = [];
    for (const [deviceName, entities] of Object.entries(byDevice)) {
        let metrics = {};
        let dashieDeviceId = null;
        for (const [attrName, state] of Object.entries(entities)) {
            const extractor = METRIC_MAP[attrName];
            if (!extractor) continue;
            const piece = extractor(state);
            if (piece._dashie_device_id !== undefined) {
                const v = piece._dashie_device_id;
                dashieDeviceId = (v === 'unavailable' || v === 'unknown') ? null : v;
                delete piece._dashie_device_id;
            }
            metrics = deepMerge(metrics, piece);
        }
        metrics = sanitizeMetrics(metrics);
        results.push({
            deviceName,
            dashieDeviceId,
            metrics,
            entityCount: Object.keys(entities).length,
            hasLiveData: hasAnyLiveData(metrics),
        });
    }
    results.sort((a, b) => a.deviceName.localeCompare(b.deviceName));
    return results;
}

module.exports = {
    DASHIE_ATTRS,
    METRIC_MAP,
    parseDashieFriendly,
    pickBetter,
    sanitizeMetrics,
    hasAnyLiveData,
    buildDeviceMetrics,
    deepMerge,
};
