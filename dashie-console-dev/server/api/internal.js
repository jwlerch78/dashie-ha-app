// server/api/internal.js
//
// Endpoints for trusted in-HA callers (the Dashie integration), reached over the
// hassio Docker network. The add-on is ingress-only (no external ports), so these
// are not reachable from outside HA.
//
// 🔐 SECURITY (Lever 1): every call must carry the shared bridge secret
// (X-Dashie-Bridge-Secret), checked by the router.use guard below via lib/bridge-auth.
// The secret is provisioned to addon_config so only the Dashie integration can read it.
// Enforced when the `bridge_auth_enforce` add-on option is on (observe-mode logs-but-allows
// until then). Build plan 20260702_BRIDGE_AUTH_HARDENING.md. Follow-up (Lever 2, not built):
// vend a scoped token instead of the raw account JWT.
//
// The account credential is only vended when the account holder has opted into
// household-wide Dashie Cloud sharing (settings-store). When off, anonymous
// tablets/satellites fall back to local voice — the credential never leaves.

const express = require('express');
const auth = require('../auth');
const { getAccountVoiceConfig } = require('../account-config');
const bridgeAuth = require('../lib/bridge-auth');
const { SUPABASE } = require('../config');

const router = express.Router();

// Authenticate every internal call with the shared bridge secret (Lever 1). Observe-mode by
// default (logs would-reject, allows) until `bridge_auth_enforce` is flipped on; then rejects.
// Build plan 20260702_BRIDGE_AUTH_HARDENING.md.
router.use((req, res, next) => {
    if (bridgeAuth.checkRequest(req, res)) next();
});

/**
 * GET /api/internal/sharing-status
 * Cheap capability probe for the integration: is the add-on signed in AND has
 * the account holder enabled household sharing? Drives whether anonymous kiosk
 * tablets may offer "Dashie Cloud". Never returns the credential.
 */
router.get('/sharing-status', async (req, res) => {
    const stored = auth.readStoredJwt();
    const signedIn = !!stored;
    // ACCOUNT-scoped (2026-07-13): read voice.householdSharing from user_settings via
    // account-config (30s cache), not the add-on's /data store. A fresh/wiped account is
    // OFF by default and can't inherit a previous account's sharing state.
    let sharing = false;
    if (signedIn) {
        try {
            const cfg = await getAccountVoiceConfig();
            sharing = cfg.householdSharing === true;
        } catch (e) {
            sharing = false;   // fail closed — never share on a config read error
        }
    }
    const available = signedIn && sharing;
    return res.json({
        available,
        signed_in: signedIn,
        household_sharing: sharing,
        reason: available ? 'ok' : (!signedIn ? 'add_on_not_signed_in' : 'sharing_disabled'),
        // Account identity for the anon-kiosk "Authorized by <email>" display —
        // household-sharing-driven. Only vended when sharing is actually available
        // (never leak the account email when sharing is off / add-on not signed in).
        ...(available && stored.userEmail ? { account_email: stored.userEmail } : {}),
    });
});

/**
 * GET /api/internal/account-credential
 * Returns the account JWT so the integration can call cloud edge functions
 * (the voice-conversation brain) on the account's behalf. Gated on the
 * household-sharing opt-in.
 */
router.get('/account-credential', async (req, res) => {
    // ACCOUNT-scoped gate (2026-07-13) — voice.householdSharing from user_settings.
    // Fails CLOSED: any read error → no credential vended.
    let sharing = false;
    try {
        const cfg = await getAccountVoiceConfig();
        sharing = cfg.householdSharing === true;
    } catch (e) {
        sharing = false;
    }
    if (!sharing) {
        return res.status(403).json({
            error: 'sharing_disabled',
            message: 'Household Dashie Cloud sharing is turned off for this account.',
        });
    }
    try {
        const stored = await auth.getValidJwt();
        return res.json({
            jwt: stored.jwt,
            user_id: stored.userId,
            jwt_expires_at: stored.expiry ? new Date(stored.expiry).toISOString() : null,
        });
    } catch (e) {
        return res.status(401).json({ error: 'not_authenticated', message: e.message });
    }
});

/**
 * POST /api/internal/authorize-device   { user_code }
 *
 * Kiosk Real Login, Phase 1 (.reference/build-plans/20260713_KIOSK_REAL_LOGIN.md).
 *
 * A LAN kiosk tablet has created a pending device code and is asking THIS HA box to authorize
 * it into the household account. The add-on already holds an account JWT, so it calls the new
 * `authorize_device_code_account` op on jwt-auth, which claims the code for this account.
 *
 * Why the add-on and not the tablet: the tablet has no account credential (that's the whole
 * point — it's anonymous). The box does. This is the "silent device-flow authorization" in the
 * plan: the account authorizes the code on the device's behalf, and the DEVICE then polls
 * jwt-auth directly for its own per-device JWT. **The session token never passes through here** —
 * we return only success/failure, never a credential.
 *
 * SECURITY (D1 — a deliberate, documented widening):
 *   - bridge-secret authed (the router.use guard above) — only the Dashie integration can call it.
 *   - Gated on household sharing, twice: here (fail-closed, so we don't even ask) and again
 *     server-side in jwt-auth (the authoritative check — an add-on can't talk its way past it).
 *   - jwt-auth additionally restricts this op to device_type='ha_kiosk', so a compromised caller
 *     cannot use it to sign a Fire TV or a phone into the account.
 *   - The authorized device is attributable (its own user_devices row) and revocable (D5:
 *     removing it makes refresh_jwt stop renewing its token).
 */
// express.json() is applied PER-ROUTE in this app (there is no global body parser) — without
// it `req.body` is undefined and the user_code silently reads as empty.
router.post('/authorize-device', express.json(), async (req, res) => {
    const userCode = (req.body && (req.body.user_code || req.body.device_code)) || '';
    if (!userCode) {
        return res.status(400).json({ error: 'missing_user_code', message: 'user_code is required' });
    }

    // Fail CLOSED on sharing — this is an authorization gate, not a liveness probe. jwt-auth
    // re-checks it server-side (that's the authoritative one); this just avoids a pointless
    // round-trip and keeps the box's own answer consistent with /sharing-status.
    let sharing = false;
    try {
        const cfg = await getAccountVoiceConfig();
        sharing = cfg.householdSharing === true;
    } catch (e) {
        sharing = false;
    }
    if (!sharing) {
        console.warn('[authorize-device] DENIED — household sharing is off');
        return res.status(403).json({
            error: 'sharing_disabled',
            message: 'Household Dashie Cloud sharing is turned off for this account.',
        });
    }

    let stored;
    try {
        stored = await auth.getValidJwt();
    } catch (e) {
        return res.status(401).json({ error: 'not_authenticated', message: e.message });
    }

    try {
        const resp = await fetch(`${SUPABASE.url}/functions/v1/jwt-auth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE.anonKey,
                Authorization: `Bearer ${stored.jwt}`,
            },
            body: JSON.stringify({
                operation: 'authorize_device_code_account',
                data: { device_code: userCode },
            }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok || body?.success !== true) {
            console.warn(`[authorize-device] jwt-auth refused (${resp.status}): ${body?.error || 'unknown'}`);
            return res.status(resp.status === 200 ? 400 : resp.status).json({
                error: body?.error || 'authorize_failed',
                message: body?.message || 'Could not authorize the device.',
            });
        }
        // D1 observability: a silent, human-free provisioning must never be an INVISIBLE one.
        console.log(`[authorize-device] ✅ kiosk code ${userCode} authorized for ${stored.userId} — the device will poll for its own session`);
        return res.json({ success: true, account_email: stored.userEmail || null });
    } catch (e) {
        console.error('[authorize-device] failed:', e?.message || e);
        return res.status(502).json({ error: 'upstream_failed', message: 'Could not reach the Dashie cloud to authorize this device.' });
    }
});

/**
 * GET /api/internal/voice-config
 * The account's voice ROUTE for the integration's gateway (M7): 'local' when the account's
 * AI model is "My Local LLM" (ai.model === 'local'), else 'cloud'. The add-on is the single
 * reader of user_settings; the integration uses this to decide cloud-vs-local without reading
 * Supabase itself. No secrets returned (the LAN endpoint stays add-on-side, used in converse-local).
 */
router.get('/voice-config', async (req, res) => {
    try {
        const cfg = await getAccountVoiceConfig();
        return res.json({
            route: cfg.route,
            // Why the route resolved this way: 'local_model' | 'hermes' | 'byok' | 'cloud'.
            // 'byok' = the account's cloud model + a provider key on this box (Open Brain §5) —
            // the brain runs HERE on the user's key, $0 to Dashie credits.
            route_reason: cfg.routeReason || (cfg.route === 'local' ? 'local_model' : 'cloud'),
            model_is_local: cfg.route === 'local',
            // Household conversation agent mode (live|dialog|single) for anonymous kiosks —
            // the integration forwards it on /api/dashie/voice/status (Live-on-kiosk, 2026-07-09).
            // '' = unset → the kiosk uses its default.
            agent_mode: cfg.agentMode || '',
            // ai.retrievePicturesEnabled for anonymous kiosks (relay image_search gate).
            // Omitted when unset so the kiosk keeps its cached/default value.
            ...(typeof cfg.retrievePictures === 'boolean' ? { retrieve_pictures: cfg.retrievePictures } : {}),
            // WS-G §13.2 account defaults for anon kiosks (device override still
            // wins on-device; '' = unset → app defaults). Forwarded by the
            // integration on /api/dashie/voice/status like agent_mode.
            default_personality_id: cfg.defaultPersonalityId || '',
            default_voice_key: cfg.defaultVoiceKey || '',
            default_wake_word: cfg.defaultWakeWord || '',
            // Account brain model (ai.model, e.g. gemini-2.5-flash / local / hermes) —
            // mirrored so an anon kiosk runs the household's model, not its own default.
            // The status view forwards it as `model`; the applier writes voice+ai prefs.
            // '' = unset → kiosk keeps its default.
            model: cfg.model || '',
            // Kiosk voice-config mirror (Phase 1): the full account voice pipeline so a
            // share-account anon kiosk reflects the household's Voice & AI setup. The
            // integration forwards this block on /api/dashie/voice/status.
            // OMITTED (not {}) when the account read failed — the applier hard-applies any
            // boolean present in the block, so a degraded serve must carry no block at all
            // rather than a zeroed one (audit 2026-07-13, #4).
            ...(cfg.pipeline ? { pipeline: cfg.pipeline } : {}),
        });
    } catch (e) {
        // Never block the gateway on this — default to cloud.
        return res.json({ route: 'cloud', model_is_local: false, agent_mode: '' });
    }
});

module.exports = router;
