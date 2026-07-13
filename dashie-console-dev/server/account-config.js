// server/account-config.js — read the account's voice/AI config from user_settings.
//
// Build plan §13.16/§13.17 (on-prem brain) + §16.7 (account-level config). The add-on is the
// single reader of user_settings for voice routing: it already holds the account JWT, so it queries
// its own row via PostgREST (RLS-scoped to the user). Both consumers use this one function:
//   - /api/voice/converse-local → endpoint + model for the LAN inference call (M6)
//   - /api/internal/voice-config → the route the integration should take (M7)
//
// The "is this account on a local model?" decision lives here: ai.model === 'local' (the generic
// "My own AI" endpoint row) or 'hermes' (the dedicated Hermes Agent row, WS-I) → route 'local';
// anything else → 'cloud'. Both are local-family sentinels: the model runs on the user's own
// hardware and the cloud edge fn can't reach it.

const auth = require('./auth');
const { SUPABASE } = require('./config');
const { resolveBrainRoute } = require('./brain/providers');

const TTL_MS = 30_000; // user_settings changes rarely; a short cache keeps converse latency low.
let _cache = null; // { at, value }

const EMPTY_PIPELINE = { sttProvider: '', ttsProvider: '', haSttEngineId: '', haTtsEngineId: '', haTtsVoiceId: '', controlMethod: '', searchSource: '', pipelinePreset: '', customizePipeline: false };
const SAFE_DEFAULT = { model: null, route: 'cloud', localLlmUrl: '', localLlmModel: '', localLlmKey: '', hermesUrl: '', retainTranscripts: false, agentMode: '', retrievePictures: null, webSearchEnabled: null, zipCode: '', defaultPersonalityId: '', defaultVoiceKey: '', defaultWakeWord: '', pipeline: EMPTY_PIPELINE };

/** Coerce a settings value to a string, '' when absent/non-string. */
function str(v) { return typeof v === 'string' ? v : ''; }

/**
 * Resolve the account's voice routing config.
 * @returns {Promise<{model: string|null, route: 'local'|'cloud', localLlmUrl: string, localLlmModel: string}>}
 *          Never throws — falls back to SAFE_DEFAULT (cloud) on any error / not-signed-in.
 */
async function getAccountVoiceConfig() {
  if (_cache && Date.now() - _cache.at < TTL_MS) return withRoute(_cache.value);

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
          localLlmUrl: settings?.voice?.localLlmUrl || '',
          localLlmModel: settings?.voice?.localLlmModel || '',
          // BYO-model API key (WS-I) — bearer for a remote OpenAI-compatible
          // endpoint. Console-only key (user_settings.voice.localLlmKey); passed to
          // node-io.js. Blank for keyless local Ollama/llama.cpp.
          localLlmKey: settings?.voice?.localLlmKey || '',
          // Hermes Agent endpoint (dedicated row, ai.model='hermes'). Its API key is
          // NOT in user_settings — it lives in the on-box key store ('hermes' provider).
          hermesUrl: settings?.voice?.hermesUrl || '',
          retainTranscripts: row.retain_transcripts === true,
          // Household conversation agent mode (live|dialog|single) — the console's Voice & AI
          // page writes user_settings.voice.agentMode (ACCOUNT_VOICE_KEYS). Carried to
          // anonymous kiosks via the integration's /api/dashie/voice/status so they behave
          // like the account chose (Live-on-kiosk, 2026-07-09). '' = unset → kiosk default.
          agentMode: typeof settings?.voice?.agentMode === 'string' ? settings.voice.agentMode : '',
          // ai.retrievePicturesEnabled — same anon-kiosk carry as agentMode (the relay
          // omits the image_search tool when false/unset). null = unset.
          retrievePictures: typeof settings?.ai?.retrievePicturesEnabled === 'boolean'
            ? settings.ai.retrievePicturesEnabled : null,
          // ai.webSearchEnabled + the ZIP SSOT (family.zipCode canon → general mirror) —
          // consumed by node-io.readAccountAiConfig so the add-on brain honors the same
          // account tool toggles the cloud brain does (BYOK tool parity, 2026-07-13).
          webSearchEnabled: typeof settings?.ai?.webSearchEnabled === 'boolean'
            ? settings.ai.webSearchEnabled : null,
          zipCode: str(settings?.family?.zipCode) || str(settings?.general?.zipCode),
          // WS-G §13.2: household account defaults — anon kiosks resolve the
          // household-sharing account's defaults (locked decision), still
          // overridable on-device. '' = unset → kiosk/app defaults
          // (Dashie personality / Hey Dashie).
          defaultPersonalityId: typeof settings?.ai?.defaultPersonalityId === 'string' ? settings.ai.defaultPersonalityId : '',
          defaultVoiceKey: typeof settings?.ai?.defaultVoiceKey === 'string' ? settings.ai.defaultVoiceKey : '',
          defaultWakeWord: typeof settings?.ai?.defaultWakeWord === 'string' ? settings.ai.defaultWakeWord : '',
          // Kiosk voice-config mirror (Phase 1, 2026-07-13): the full account voice
          // pipeline so a share-account anon kiosk reflects the household's Voice & AI
          // setup (Cloud/Hybrid/Local providers + HA engine ids + voice + model),
          // not just agentMode. '' = unset → the kiosk keeps its own default for that
          // key. Consumed by DashieCloudCapabilityClient on the anon-kiosk path.
          pipeline: {
            sttProvider: str(settings?.voice?.sttProvider),
            ttsProvider: str(settings?.voice?.ttsProvider),
            haSttEngineId: str(settings?.voice?.haSttEngineId),
            haTtsEngineId: str(settings?.voice?.haTtsEngineId),
            haTtsVoiceId: str(settings?.voice?.haTtsVoiceId),
            // controlMethod is the runtime's engine-domain key that the anon-kiosk
            // mirror routes on (Cloud vs HA Assist). The console only persists it
            // when it differs from the display default, so a cloud account often
            // has it BLANK in user_settings while pipelinePreset='cloud'. Derive it
            // from the preset when empty — mirrors on-device VoicePresetSeeder
            // (cloud/hybrid/local → dashie_cloud, ha_assist → voice_assistant) so
            // the kiosk actually switches instead of keeping its HA-Assist default.
            controlMethod: str(settings?.voice?.controlMethod)
              || (str(settings?.voice?.pipelinePreset)
                    ? (settings.voice.pipelinePreset === 'ha_assist' ? 'voice_assistant' : 'dashie_cloud')
                    : ''),
            searchSource: str(settings?.voice?.searchSource),
            pipelinePreset: str(settings?.voice?.pipelinePreset),
            customizePipeline: settings?.voice?.customizePipeline === true,
          },
        };
      }
    }
  } catch (e) {
    console.warn('[account-config] user_settings read failed; defaulting to cloud:', e?.message || e);
    value = SAFE_DEFAULT;
  }

  _cache = { at: Date.now(), value };
  return withRoute(value);
}

/** Stamp `route`/`routeReason` FRESH on every read (outside the settings cache): the route
 *  depends on the box's key store too (Open Brain §5 BYOK), and a key add/remove must flip
 *  routing immediately, not after the settings TTL. resolveBrainRoute reads the key file —
 *  cheap. `route`: 'local' = run the brain in this add-on; 'cloud' = the metered edge fn. */
function withRoute(value) {
  const { route, reason } = resolveBrainRoute(value);
  return { ...value, route, routeReason: reason };
}

/** Drop the cache (e.g. after a known settings change). */
function invalidate() { _cache = null; }

module.exports = { getAccountVoiceConfig, invalidate };
