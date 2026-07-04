// server/lib/bridge-auth.js
//
// Authenticates the internal add-on↔integration bridge (build plan 20260702_BRIDGE_AUTH_HARDENING.md,
// Lever 1). The `/api/internal/*` endpoints vend the account JWT; historically they were
// network-trust only (any component on the hassio network could call them). This adds a shared
// secret the integration must present.
//
// Provisioning (leak-proof, zero-touch): the secret is generated once and persisted in the add-on's
// PRIVATE /data, then mirrored to the add-on's `addon_config` mount (HA `addon_config:rw`). That mount
// surfaces to HA Core at /config/addon_configs/dashie/ — readable by the Dashie integration but NOT by
// other add-ons (each add-on only sees its OWN addon_config). /share or /config would leak to sibling
// add-ons, so we deliberately do NOT use those.
//
// Rollout (observe → enforce, per §13.16 cadence skew): default OFF — a missing/wrong header is
// logged as "would-reject" but ALLOWED, so a new add-on doesn't 401 an old integration. Flip the
// `bridge_auth_enforce` add-on option to true (Configuration tab) once both sides are updated.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');

const SECRET_FILE = path.join(DATA_DIR, 'bridge_secret.txt');
// In-container mount point for the `addon_config:rw` map — HA has used BOTH `/config`
// (modern) and `/addon_config` across versions, and it surfaces to HA Core at
// /config/addon_configs/<slug>/. We write to whichever candidate actually exists so we
// don't depend on the convention. Safe: this add-on maps ONLY data + addon_config, so an
// in-container `/config` can only be the addon_config mount (no homeassistant_config here).
const ADDON_CONFIG_CANDIDATES = ['/addon_config', '/config'];
const OPTIONS_FILE = '/data/options.json';
const HEADER = 'x-dashie-bridge-secret';

let _secret = null;

/** Load the persisted secret, or generate + persist a new one. Cached in-process. */
function loadOrCreateSecret() {
    if (_secret) return _secret;
    try {
        if (fs.existsSync(SECRET_FILE)) {
            const s = fs.readFileSync(SECRET_FILE, 'utf8').trim();
            if (s) { _secret = s; return _secret; }
        }
    } catch (e) {
        console.error('[bridge-auth] failed to read secret:', e.message);
    }
    _secret = crypto.randomBytes(32).toString('hex');
    try {
        const tmp = SECRET_FILE + '.tmp';
        fs.writeFileSync(tmp, _secret, { mode: 0o600 });
        fs.renameSync(tmp, SECRET_FILE);
        console.log('[bridge-auth] generated a new bridge secret');
    } catch (e) {
        console.error('[bridge-auth] failed to persist secret:', e.message);
    }
    return _secret;
}

/**
 * Mirror the secret to the addon_config channel so the integration can read it. Called on startup.
 * No-op (with a warning) if the addon_config mount is absent — the integration then finds no secret
 * and sends no header, which observe-mode accepts (and enforce-mode would reject — so verify the
 * mount before flipping enforce).
 */
function provision() {
    const secret = loadOrCreateSecret();
    let wrote = 0;
    for (const dir of ADDON_CONFIG_CANDIDATES) {
        try {
            if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
            const dst = path.join(dir, 'bridge_secret');
            const tmp = dst + '.tmp';
            fs.writeFileSync(tmp, secret, { mode: 0o600 });
            fs.renameSync(tmp, dst);
            console.log(`[bridge-auth] secret provisioned to ${dst} (surfaces to HA Core at /config/addon_configs/dashie/)`);
            wrote++;
        } catch (e) {
            console.warn(`[bridge-auth] could not write ${dir}: ${e.message}`);
        }
    }
    if (!wrote) {
        console.warn(`[bridge-auth] no addon_config mount found (tried ${ADDON_CONFIG_CANDIDATES.join(', ')}) — ` +
            "is 'addon_config:rw' in config.yaml map? Integration can't read the secret; keep bridge_auth_enforce OFF.");
    }
}

/** Is the shared-secret check ENFORCED? Read from the add-on option (default OFF). */
function enforceEnabled() {
    try {
        const opts = JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8'));
        return opts.bridge_auth_enforce === true;
    } catch {
        return false;
    }
}

/**
 * Guard an internal request. Returns true if it may proceed. On a bad/missing secret: rejects
 * (401, returns false) when enforce is ON, else logs "would-reject" and allows (returns true).
 * Uses a constant-time compare to avoid leaking the secret via timing.
 */
function checkRequest(req, res) {
    const provided = (req.get(HEADER) || '').trim();
    const secret = loadOrCreateSecret();
    const ok = provided.length > 0 &&
        provided.length === secret.length &&
        crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
    if (ok) return true;

    const reason = provided ? 'bad_secret' : 'missing_secret';
    if (enforceEnabled()) {
        console.warn(`[bridge-auth] REJECTED internal call (${reason})`);
        res.status(401).json({ error: 'bridge_unauthorized', reason });
        return false;
    }
    console.warn(`[bridge-auth] would-reject internal call (${reason}) — enforce OFF, allowing`);
    return true;
}

module.exports = { loadOrCreateSecret, provision, enforceEnabled, checkRequest, HEADER };
