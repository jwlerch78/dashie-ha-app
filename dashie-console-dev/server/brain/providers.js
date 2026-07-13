// server/brain/providers.js — BYO-key provider resolution for the add-on brain (Open Brain
// plan 20260710_OPEN_BRAIN_BYOK_PRESETS_UI.md §5, WS-C).
//
// One question, answered in one place: given the account's chosen AI model and the box's
// key store, WHERE does the brain run and WHAT endpoint does node-io hit?
//
//   ai.model = 'local' | 'hermes'      → add-on brain, user's own endpoint (pre-existing)
//   ai.model = cloud id + BYO key set  → add-on brain, that provider's OpenAI-compatible
//                                        endpoint with the stored key (this module)
//   anything else                      → cloud edge fn (Dashie credits)
//
// v1 BYOK providers are the OpenAI-compatible set: OpenAI + Gemini (its /openai compat
// surface) + Hermes. Claude and Bedrock keys can be STORED (key-store.js) but need thin
// protocol adapters (Anthropic messages / SigV4) — deferred, so a stored claude/bedrock key
// deliberately does NOT flip routing (turns stay on the metered cloud brain, which is not a
// silent-degradation case: nothing was promised to run on that key yet).
//
// The model→provider prefix sniff is ported from the cloud brain
// (supabase/functions/voice-conversation/models.ts) minus the catch-all: models.ts defaults
// unknown ids to 'claude' because it must always pick a gateway lane, but here an unknown id
// (e.g. 'home_assistant', '') must mean "not a BYOK candidate", never "claude".

const keyStore = require('../key-store');

/** Model id → provider id, or null when the id doesn't look like a known cloud model. */
function providerForModel(modelId) {
    if (!modelId || typeof modelId !== 'string') return null;
    const id = modelId.toLowerCase();
    if (id.startsWith('claude-')) return 'claude';
    if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3')) return 'openai';
    if (id.startsWith('gemini-')) return 'gemini';
    if (id.startsWith('us.amazon.') || id.startsWith('bedrock-') || id.includes('nova')) return 'bedrock';
    return null;
}

/** Providers node-io can serve today: OpenAI-compatible /chat/completions with a bearer.
 *  chatUrl is the FULL completions URL (Gemini's compat path isn't /v1/...). */
const OPENAI_COMPAT = {
    openai: { chatUrl: 'https://api.openai.com/v1/chat/completions', label: 'OpenAI' },
    gemini: { chatUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', label: 'Gemini' },
};

/**
 * Should this account's brain run in the add-on, and why?
 * @param {object} acct  getAccountVoiceConfig() result (needs .model)
 * @returns {{route: 'local'|'cloud', reason: 'local_model'|'hermes'|'byok'|'cloud', provider?: string}}
 */
function resolveBrainRoute(acct) {
    const model = acct?.model || null;
    if (model === 'hermes') return { route: 'local', reason: 'hermes' };
    if (model === 'local') return { route: 'local', reason: 'local_model' };
    const provider = providerForModel(model);
    if (provider && OPENAI_COMPAT[provider] && keyStore.status()[provider]) {
        return { route: 'local', reason: 'byok', provider };
    }
    return { route: 'cloud', reason: 'cloud' };
}

/**
 * Resolve the concrete inference target for a BYOK cloud model. Returns null when the model's
 * provider has no stored key or no adapter — callers surface an EXPLICIT error (degradation
 * rule WS-I.8: never silently fall back to the metered Dashie brain).
 * @returns {{chatUrl: string, key: string, provider: string, label: string} | null}
 */
function resolveByokTarget(model) {
    const provider = providerForModel(model);
    if (!provider || !OPENAI_COMPAT[provider]) return null;
    const entry = keyStore.readKeys()[provider];
    if (!entry || !entry.key) return null;
    return { chatUrl: OPENAI_COMPAT[provider].chatUrl, key: entry.key, provider, label: OPENAI_COMPAT[provider].label };
}

module.exports = { providerForModel, resolveBrainRoute, resolveByokTarget, OPENAI_COMPAT };
