// server/account-config.js — read the account's voice/AI config from user_settings.
//
// Build plan §13.16/§13.17 (on-prem brain) + §16.7 (account-level config). The add-on is the
// single reader of user_settings for voice routing: it already holds the account JWT, so it queries
// its own row via PostgREST (RLS-scoped to the user). Both consumers use this one function:
//   - /api/voice/converse-local → endpoint + model for the LAN inference call (M6)
//   - /api/internal/voice-config → the route the integration should take (M7)
//
// The "is this account on a local model?" decision lives here: ai.model === 'local' (the sentinel
// the Console writes for the "My Local LLM" option) → route 'local'; anything else → 'cloud'.

const auth = require('./auth');
const { SUPABASE } = require('./config');

const TTL_MS = 30_000; // user_settings changes rarely; a short cache keeps converse latency low.
let _cache = null; // { at, value }

const SAFE_DEFAULT = { model: null, route: 'cloud', localLlmUrl: '', localLlmModel: '', retainTranscripts: false, agentMode: '' };

/**
 * Resolve the account's voice routing config.
 * @returns {Promise<{model: string|null, route: 'local'|'cloud', localLlmUrl: string, localLlmModel: string}>}
 *          Never throws — falls back to SAFE_DEFAULT (cloud) on any error / not-signed-in.
 */
async function getAccountVoiceConfig() {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.value;

  let value = SAFE_DEFAULT;
  try {
    const { jwt, userId } = await auth.getValidJwt();
    if (jwt && userId) {
      // retain_transcripts is a dedicated column (not in the settings blob) — same source
      // retention.ts reads. Governs whether the brain keeps the turn's transcript.
      const url = `${SUPABASE.url}/rest/v1/user_settings`
        + `?auth_user_id=eq.${encodeURIComponent(userId)}&select=settings,retain_transcripts`;
      const resp = await fetch(url, {
        headers: { apikey: SUPABASE.anonKey, Authorization: `Bearer ${jwt}` },
      });
      if (resp.ok) {
        const rows = await resp.json().catch(() => []);
        const row = (Array.isArray(rows) && rows[0]) || {};
        const settings = row.settings || {};
        const model = settings?.ai?.model || null;
        value = {
          model,
          route: model === 'local' ? 'local' : 'cloud',
          localLlmUrl: settings?.voice?.localLlmUrl || '',
          localLlmModel: settings?.voice?.localLlmModel || '',
          retainTranscripts: row.retain_transcripts === true,
          // Household conversation agent mode (live|dialog|single) — the console's Voice & AI
          // page writes user_settings.voice.agentMode (ACCOUNT_VOICE_KEYS). Carried to
          // anonymous kiosks via the integration's /api/dashie/voice/status so they behave
          // like the account chose (Live-on-kiosk, 2026-07-09). '' = unset → kiosk default.
          agentMode: typeof settings?.voice?.agentMode === 'string' ? settings.voice.agentMode : '',
        };
      }
    }
  } catch (e) {
    console.warn('[account-config] user_settings read failed; defaulting to cloud:', e?.message || e);
    value = SAFE_DEFAULT;
  }

  _cache = { at: Date.now(), value };
  return value;
}

/** Drop the cache (e.g. after a known settings change). */
function invalidate() { _cache = null; }

module.exports = { getAccountVoiceConfig, invalidate };
