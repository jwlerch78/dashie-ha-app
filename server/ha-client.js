// server/ha-client.js
// Thin wrapper around Home Assistant's REST API.
//
// Two modes, auto-detected by env:
//   Production (HAOS add-on): SUPERVISOR_TOKEN → base URL http://supervisor/core
//   Local dev:                DASHIE_HA_URL + DASHIE_HA_TOKEN (long-lived token)

function getConfig() {
    if (process.env.SUPERVISOR_TOKEN) {
        return {
            baseUrl: 'http://supervisor/core',
            token: process.env.SUPERVISOR_TOKEN,
            mode: 'supervisor',
        };
    }
    if (process.env.DASHIE_HA_URL && process.env.DASHIE_HA_TOKEN) {
        return {
            baseUrl: process.env.DASHIE_HA_URL.replace(/\/$/, ''),
            token: process.env.DASHIE_HA_TOKEN,
            mode: 'dev-llat',
        };
    }
    return null;
}

function isAvailable() {
    return getConfig() !== null;
}

async function checkConnection() {
    const config = getConfig();
    if (!config) return { ok: false, reason: 'not_configured' };
    try {
        const resp = await fetch(`${config.baseUrl}/api/`, {
            headers: { Authorization: `Bearer ${config.token}` },
        });
        const data = await resp.json().catch(() => null);
        return {
            ok: resp.ok,
            status: resp.status,
            mode: config.mode,
            baseUrl: config.baseUrl,
            message: data?.message || null,
        };
    } catch (e) {
        return { ok: false, error: e.message, mode: config.mode, baseUrl: config.baseUrl };
    }
}

/** Returns an array of state objects: { entity_id, state, attributes, last_changed, last_updated } */
async function getStates() {
    const config = getConfig();
    if (!config) throw new Error('HA client not configured');
    const resp = await fetch(`${config.baseUrl}/api/states`, {
        headers: { Authorization: `Bearer ${config.token}` },
    });
    if (!resp.ok) throw new Error(`/api/states: HTTP ${resp.status}`);
    return resp.json();
}

/** Get a single entity's state. */
async function getState(entityId) {
    const config = getConfig();
    if (!config) throw new Error('HA client not configured');
    const resp = await fetch(`${config.baseUrl}/api/states/${encodeURIComponent(entityId)}`, {
        headers: { Authorization: `Bearer ${config.token}` },
    });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`/api/states/${entityId}: HTTP ${resp.status}`);
    return resp.json();
}

module.exports = {
    getConfig,
    isAvailable,
    checkConnection,
    getStates,
    getState,
};
