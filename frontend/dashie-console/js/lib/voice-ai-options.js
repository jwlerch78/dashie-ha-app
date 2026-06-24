/* ============================================================
   Voice & AI option descriptors
   ------------------------------------------------------------
   Single source for the component-card options on the Voice & AI
   settings page. Each option is { id, label, description, locality,
   cost, comingSoon?, configFields? }.

   - locality: 'cloud' | 'local' — drives the orange/green color
     coding (NO icons; color only).
   - cost: a short human string (per-token + per-turn for models,
     per-unit for STT/TTS/Search; 'Free' for local/native).
   - comingSoon: true for engines not yet wired to the runtime
     (Local LLM, SearXNG, bundled Whisper/Piper) — configurable
     now (storage-first), active once the L3 add-on brain ships.
   - configFields: revealed when that option is selected; each
     persists to its own account-level user_settings key.

   Model cost is pulled live from window.AiModelCatalog so it never
   drifts; STT/TTS/Search rates are small static tables here.
   ============================================================ */

const VoiceAiOptions = {
    // Orange = cloud, green = local. Used by voice-ai-cards.js.
    COLOR: { cloud: '#f97316', local: '#16a34a' },
    LABEL: { cloud: 'Cloud', local: 'Local' },

    // Typical turn token estimate for the per-turn model cost (≈ the
    // 1342-in / 145-out seen in real sports turns).
    _TURN_IN: 1300,
    _TURN_OUT: 150,

    /** Model options: every cloud catalog model + the local-LLM route.
     *  Cost comes from AiModelCatalog.pricingFor so it tracks the catalog. */
    models() {
        const C = window.AiModelCatalog;
        const cloud = (C?.AI_MODEL_CATALOG || []).map(m => {
            const p = C.pricingFor(m.id);   // [inPer1M, outPer1M] | null
            return {
                id: m.id,
                label: m.name,
                description: m.description || '',
                locality: 'cloud',
                cost: p ? this._modelCost(p) : '',
                comingSoon: false,
            };
        });
        const local = {
            id: 'local',
            label: 'My Local LLM',
            description: 'Runs on your own hardware (Ollama / llama.cpp). Nothing leaves your network.',
            locality: 'local',
            cost: 'Free',
            comingSoon: true,
            configFields: [
                { key: 'voice.localLlmUrl', label: 'Endpoint URL', placeholder: 'http://192.168.1.50:11434' },
                { key: 'voice.localLlmModel', label: 'Model', placeholder: 'qwen3:8b' },
            ],
        };
        return [...cloud, local];
    },

    STT: [
        { id: 'deepgram', label: 'Deepgram', locality: 'cloud', cost: '$0.0043/min · ~0.04¢/command',
          description: 'Streaming, premium accuracy.' },
        { id: 'whisper', label: 'Whisper (OpenAI)', locality: 'cloud', cost: '$0.006/min',
          description: 'Cloud batch transcription.' },
        { id: 'native', label: 'Device native', locality: 'local', cost: 'Free',
          description: 'Built-in Android / browser speech recognition.' },
        { id: 'local-whisper', label: 'Local Whisper', locality: 'local', cost: 'Free', comingSoon: true,
          description: 'On-device whisper.cpp — offline, nothing leaves the LAN.' },
    ],

    TTS: [
        { id: 'elevenlabs', label: 'ElevenLabs', locality: 'cloud', cost: '$0.18/1k chars · ~1–2¢/reply',
          description: 'Premium character voices.' },
        { id: 'openai', label: 'OpenAI TTS', locality: 'cloud', cost: '$15/1M chars',
          description: 'Cloud neural voices.' },
        { id: 'native', label: 'Device / HA (native)', locality: 'local', cost: 'Free',
          description: 'Android TTS or Home Assistant Piper.' },
        { id: 'piper', label: 'Piper (local)', locality: 'local', cost: 'Free', comingSoon: true,
          description: 'Bundled local voice — offline.',
          configFields: [{ key: 'voice.localTtsUrl', label: 'Piper endpoint (optional)', placeholder: 'http://homeassistant.local:10200' }] },
    ],

    SEARCH: [
        { id: 'dashie', label: 'Dashie (Tavily)', locality: 'cloud', cost: '1,000/mo free, then ~0.8¢/search',
          description: 'Managed web search — no setup.' },
        { id: 'searxng', label: 'SearXNG (self-hosted)', locality: 'local', cost: 'Free', comingSoon: true,
          description: 'Your own metasearch instance — private, no per-search cost.',
          configFields: [{ key: 'voice.searxngUrl', label: 'SearXNG instance URL', placeholder: 'http://192.168.1.50:8080' }] },
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
