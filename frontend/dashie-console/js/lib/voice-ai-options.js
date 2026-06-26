/* ============================================================
   Voice & AI option descriptors
   ------------------------------------------------------------
   Single source for the component-card options on the Voice & AI
   settings page. Each option is { id, label, description, locality,
   cost, group?, comingSoon?, configFields? }.

   - locality: 'cloud' | 'local' — drives color: cloud rows shade
     light-orange, local rows light-green (COLOR = the strong swatch,
     BG = the row background tint). No icons; color only.
   - cost: a short human string (per-token + per-turn for models,
     per-unit for STT/TTS/Search; 'Free' for local/native).
   - group: optional section header within a card (model card groups
     by provider; STT/TTS/Search have none).
   - comingSoon: engines not yet wired to the runtime (Local LLM,
     SearXNG, bundled Whisper/Piper) — configurable now (storage-
     first), active once the L3 add-on brain ships.
   - configFields: revealed when the option is selected; each
     persists to its own account-level user_settings key.

   Model list + cost come live from window.AiModelCatalog so they
   never drift; STT/TTS/Search are small static tables here.
   ============================================================ */

const VoiceAiOptions = {
    // Strong swatch (tags, legend) + light row-background tint.
    COLOR: { cloud: '#f97316', local: '#16a34a' },
    BG: { cloud: 'rgba(249, 115, 22, 0.08)', local: 'rgba(22, 163, 74, 0.10)' },
    LABEL: { cloud: 'Cloud', local: 'Local' },

    // Typical turn token estimate for the per-turn model cost (≈ the
    // 1342-in / 145-out seen in real sports turns).
    _TURN_IN: 1300,
    _TURN_OUT: 150,

    // Provider section order + display labels for the AI Model card.
    _PROVIDER_ORDER: ['gemini', 'claude', 'openai', 'bedrock'],
    _PROVIDER_LABEL: { claude: 'Claude', openai: 'OpenAI', gemini: 'Google Gemini', bedrock: 'Amazon Bedrock' },

    /** Model options: every cloud catalog model (grouped by provider) plus the
     *  local-LLM route. Cost comes from AiModelCatalog.pricingFor so it tracks
     *  the catalog. */
    models() {
        const C = window.AiModelCatalog;
        const all = C?.AI_MODEL_CATALOG || [];
        // "My Local LLM" leads the list — the privacy/local-first option (build plan §16.4).
        // Selecting it stores ai.model='local' (the route signal) + the endpoint/model config
        // fields; the integration + add-on read these to run the on-prem brain (§13.17). The
        // "coming soon" badge stays until the on-prem path is deployed end-to-end — it does NOT
        // block selection (selecting it already drives routing for testing).
        const out = [{
            id: 'local',
            label: 'My Local LLM',
            group: 'Local',
            description: 'Runs on your own hardware (Ollama / llama.cpp). Nothing leaves your network.',
            locality: 'local',
            cost: 'Free',
            comingSoon: true,
            configFields: [
                { key: 'voice.localLlmUrl', label: 'Endpoint URL', placeholder: 'http://192.168.1.50:11434' },
                { key: 'voice.localLlmModel', label: 'Model', placeholder: 'qwen3:8b' },
            ],
        }];
        for (const prov of this._PROVIDER_ORDER) {
            for (const m of all.filter(x => x.provider === prov)) {
                const p = C.pricingFor(m.id);   // [inPer1M, outPer1M] | null
                out.push({
                    id: m.id,
                    label: m.name,
                    description: m.description || '',
                    locality: 'cloud',
                    cost: p ? this._modelCost(p) : '',
                    group: this._PROVIDER_LABEL[prov] || prov,
                });
            }
        }
        return out;
    },

    // Engine domain (matches Kotlin VoicePreferences + the runtime voice providers):
    // dashie_cloud = fixed cloud vendor; va_default = the device's Home Assistant
    // voice pipeline; android_voice = on-device. `haOnly` options are hidden for
    // non-HA accounts (gated on DashieAuth.isHaUser by the page).
    STT: [
        { id: 'dashie_cloud', label: 'Dashie Cloud (Deepgram)', locality: 'cloud', cost: '$0.0043/min · ~0.04¢/command',
          description: 'Streaming, premium accuracy.' },
        { id: 'va_default', label: 'Home Assistant', locality: 'local', cost: 'Free', haOnly: true,
          description: "Your Home Assistant voice pipeline's speech-to-text." },
        { id: 'android_voice', label: 'Android voice', locality: 'local', cost: 'Free',
          description: 'Built-in Android / browser speech recognition.' },
        { id: 'local-whisper', label: 'Local Whisper', locality: 'local', cost: 'Free', comingSoon: true,
          description: 'On-device whisper.cpp — offline, nothing leaves the LAN.' },
    ],

    TTS: [
        { id: 'dashie_cloud', label: 'Dashie Cloud (ElevenLabs)', locality: 'cloud', cost: '$0.18/1k chars · ~1–2¢/reply',
          description: 'Premium character voices.' },
        { id: 'va_default', label: 'Home Assistant', locality: 'local', cost: 'Free', haOnly: true,
          description: "Your Home Assistant voice pipeline's text-to-speech." },
        { id: 'android_voice', label: 'Android voice', locality: 'local', cost: 'Free',
          description: 'Built-in Android text-to-speech.' },
        { id: 'piper', label: 'Piper', locality: 'local', cost: 'Free', haOnly: true, comingSoon: true,
          description: 'Home Assistant Piper voice — offline.',
          configFields: [{ key: 'voice.localTtsUrl', label: 'Piper endpoint (optional)', placeholder: 'http://homeassistant.local:10200' }] },
    ],

    SEARCH: [
        { id: 'dashie', label: 'Dashie (Tavily)', locality: 'cloud', cost: '~0.8¢/search',
          description: 'Managed web search — no setup.' },
        { id: 'searxng', label: 'SearXNG (self-hosted)', locality: 'local', cost: 'Free', comingSoon: true,
          description: 'Your own metasearch instance — private, no per-search cost.',
          configFields: [{ key: 'voice.searxngUrl', label: 'SearXNG instance URL', placeholder: 'http://192.168.1.50:8080' }] },
    ],

    // Sports has a single source today (free ESPN). Listing it makes clear that
    // sports questions don't run through paid web search.
    SPORTS: [
        { id: 'espn', label: 'ESPN', locality: 'cloud', cost: 'Free — not billed',
          description: 'Live scores & schedules. Sports questions use ESPN, not web search.' },
    ],

    // ── cost formatting ──────────────────────────────────────

    _modelCost(p) {
        const [inR, outR] = p;   // per 1M tokens
        const perTurn = (this._TURN_IN * inR + this._TURN_OUT * outR) / 1e6;   // USD
        return `$${inR}/$${outR} per 1M · ${this._cents(perTurn)}/turn`;
    },
    _cents(usd) {
        if (!usd) return 'free';
        const c = usd * 100;
        return c < 1 ? `~${c.toFixed(2)}¢` : `~${c.toFixed(1)}¢`;
    },
};

window.VoiceAiOptions = VoiceAiOptions;
