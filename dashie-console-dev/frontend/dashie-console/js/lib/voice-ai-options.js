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
   - installGuide: { url, label? } — renders an "Install ↗" badge-link
     on a still-selectable row. Used when there's no HA add-on to
     deep-link via _installRow (e.g. SearXNG — self-hosted anywhere).

   Model list + cost come live from window.AiModelCatalog so they
   never drift; STT/TTS/Search are small static tables here.
   ============================================================ */

const VoiceAiOptions = {
    // Strong swatch (tags, legend) + light row-background tint.
    COLOR: { cloud: '#f97316', local: '#16a34a' },
    BG: { cloud: 'rgba(249, 115, 22, 0.08)', local: 'rgba(22, 163, 74, 0.10)' },
    LABEL: { cloud: 'Cloud', local: 'Local' },

    // ── pipeline presets (Open Brain plan §6) ─────────────────
    // The top-level Voice & AI selector: three Dashie Intelligence presets
    // (Cloud / Hybrid / Local) + HA Voice Assist. Stored in
    // voice.pipelinePreset; granular providers are seeded from the preset
    // and Customize lets them diverge. Cloud & Hybrid need credits OR a
    // BYO AI key (add-on API Keys page) — gated by the page, never a
    // silent charge.
    PRESETS: [
        { id: 'cloud', label: 'Cloud', locality: 'cloud', cost: 'Uses credits', needsCreditsOrKey: true,
          tagline: 'Best quality, zero setup',
          description: 'Premium cloud AI and voices, ready out of the box.' },
        { id: 'hybrid', label: 'Hybrid', locality: 'mixed', cost: 'Credits or your AI key', needsCreditsOrKey: true,
          tagline: 'Cloud AI · local voice',
          // Two-tone tagline: the cloud half renders in the cloud swatch, the
          // local half in the local swatch (picker falls back to `tagline`).
          taglineParts: [{ text: 'Cloud AI', locality: 'cloud' }, { text: 'local voice', locality: 'local' }],
          description: 'Cloud-quality AI with free, private voice engines on your own hardware.' },
        { id: 'local', label: 'Local', locality: 'local', cost: 'Free',
          tagline: 'Free & private',
          description: 'Your own AI model and voice engines. Nothing leaves your network.' },
        { id: 'ha_assist', label: 'HA Voice Assist', locality: 'local', cost: 'Free', haOnly: true,
          tagline: 'Home Assistant’s pipeline',
          description: 'Hand voice off to Home Assistant’s Assist pipeline, configured in HA.' },
    ],

    /** Filter a picker option list by the active preset (§6): Local hides
     *  cloud rows, Cloud hides local rows, Hybrid shows both minus the HA
     *  Assist pipeline row (va_default), HA Assist shows no pickers at all. */
    presetFilter(presetId, options) {
        if (presetId === 'local')  return options.filter(o => o.locality === 'local');
        if (presetId === 'cloud')  return options.filter(o => o.locality === 'cloud');
        if (presetId === 'hybrid') return options.filter(o => o.id !== 'va_default');
        if (presetId === 'ha_assist') return [];
        return options;
    },

    // Typical turn token estimate for the per-turn model cost (≈ the
    // 1342-in / 145-out seen in real sports turns).
    _TURN_IN: 1300,
    _TURN_OUT: 150,

    // Provider section order + display labels for the AI Model card.
    _PROVIDER_ORDER: ['gemini', 'claude', 'openai', 'bedrock'],
    _PROVIDER_LABEL: { claude: 'Claude', openai: 'OpenAI', gemini: 'Google Gemini', bedrock: 'Amazon Bedrock' },

    /** Model options: every cloud catalog model (grouped by provider) plus the
     *  local-LLM route. Cost prefers the live margined rate card (applyLiveRates)
     *  — what the user actually pays — falling back to the bundled raw catalog
     *  (AiModelCatalog.pricingFor) when the card hasn't loaded. */
    models() {
        const C = window.AiModelCatalog;
        const all = C?.AI_MODEL_CATALOG || [];
        // "My Local LLM" leads the list — the privacy/local-first option (build plan §16.4).
        // Selecting it stores ai.model='local' (the route signal) + the endpoint/model config
        // fields; the integration + add-on read these to run the on-prem brain (§13.17).
        const out = [{
            id: 'local',
            label: 'My own AI (local / self-hosted)',
            group: 'Local',
            // BYO-model (Voice Master Plan WS-I): keep Dashie's cards/tools/dialog,
            // swap the model behind the brain — local Ollama/llama.cpp, a self-hosted
            // Hermes agent, or any OpenAI-compatible endpoint (remote URLs OK; add a
            // key for Hermes/remote). Unlisted models bill $0 (managed STT/TTS still metered).
            description: 'Point the brain at your own model — local Ollama / llama.cpp, a self-hosted Hermes agent, or any OpenAI-compatible endpoint. Dashie keeps its cards, tools & dialog; only the model changes.',
            locality: 'local',
            cost: 'Free',
            configFields: [
                { key: 'voice.localLlmUrl', label: 'Endpoint URL', placeholder: 'http://192.168.1.50:11434  (or https://your-hermes.example.com)' },
                { key: 'voice.localLlmModel', label: 'Model', placeholder: 'qwen3:8b' },
                { key: 'voice.localLlmKey', label: 'API key (optional)', type: 'password', placeholder: 'for Hermes / remote endpoints' },
            ],
        }];
        for (const prov of this._PROVIDER_ORDER) {
            for (const m of all.filter(x => x.provider === prov)) {
                const live = this._liveModelRates?.[m.id];   // margined, from rate card
                const p = live ? [live.input, live.output] : C.pricingFor(m.id);   // [inPer1M, outPer1M] | null
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
    // Base STT rows that always exist regardless of detection. The detected
    // engine-direct row (ha_engine, labeled "Whisper (Home Assistant)") is
    // injected by sttOptions() when /api/voice/engines finds a Whisper engine.
    STT: [
        { id: 'dashie_cloud', label: 'Dashie Cloud (Deepgram)', locality: 'cloud', cost: '$0.0043/min · ~0.04¢/command',
          description: 'Streaming, premium accuracy.' },
        { id: 'local_stt_url', label: 'Local Whisper (your box)', locality: 'local', cost: 'Free',
          description: 'Whisper server on your own box (OpenAI-compatible, LAN, direct).',
          configFields: [
            { key: 'voice.localSttUrl', label: 'Whisper box URL', placeholder: 'http://192.168.1.50:8000', probe: 'stt' },
          ] },
        { id: 'va_default', label: 'Home Assistant', locality: 'local', cost: 'Free', haOnly: true,
          description: "Your Home Assistant voice pipeline's speech-to-text." },
        { id: 'android_voice', label: 'Android voice', locality: 'local', cost: 'Free',
          description: 'Built-in Android / browser speech recognition.' },
    ],

    // Base TTS rows that always exist. The detected engine-direct row (ha_engine,
    // labeled "Piper (Home Assistant)") is injected by ttsOptions() when
    // detection finds a Piper engine on HA.
    TTS: [
        // cost is a fallback estimate — applyLiveRates() overwrites the rate from
        // the server's margined rate card; the "~½–1¢/reply" estimate stays static.
        { id: 'dashie_cloud', label: 'Dashie Cloud (ElevenLabs)', locality: 'cloud', cost: '$0.13/1k chars · ~½–1¢/reply',
          description: 'Premium character voices.' },
        { id: 'local_url', label: 'Local TTS (your box)', locality: 'local', cost: 'Free',
          description: 'Kokoro / OpenAI-compatible TTS on your own box (LAN, direct).',
          configFields: [
            { key: 'voice.localTtsUrl', label: 'TTS box URL', placeholder: 'http://192.168.1.50:8880', probe: 'tts' },
            { key: 'voice.localTtsVoiceId', label: 'Voice', placeholder: 'af_heart' },
          ] },
        { id: 'va_default', label: 'Home Assistant', locality: 'local', cost: 'Free', haOnly: true,
          description: "Your Home Assistant voice pipeline's text-to-speech." },
        { id: 'android_voice', label: 'Android voice', locality: 'local', cost: 'Free',
          description: 'Built-in Android text-to-speech.' },
    ],

    // ── detection-gated option builders ──────────────────────
    // Turn the static base rows into the live option set for the picker, adding
    // the engine-direct HA row (provider id `ha_engine`, transport-named — NOT
    // engine-named; the engine itself is carried in haTtsEngineId/haSttEngineId)
    // ONLY when detection found a matching engine, and upgrading free-text voice
    // fields to dropdowns when detection returned a voice list. `detection` =
    // GET /api/voice/engines ({ available, tts, stt, kokoro }) or null (no HA /
    // cloud mode). See build plan 20260708 §5.2. Decision §11.1: a single
    // canonical "…(Home Assistant)" row bound to the first matching engine; the
    // label names the common engine (Piper/Whisper) for humans, the id is the
    // transport so one native client serves any HA engine.

    _matchEngine(list, re) {
        if (!Array.isArray(list)) return null;
        return list.find(e => re.test(String(e.engine_id || '')) || re.test(String(e.name || ''))) || null;
    },

    /** TTS option list in the §3 order: cloud, Piper (if detected), your-box, HA
     *  pipeline, Android. */
    ttsOptions(detection) {
        const base = Object.fromEntries(this.TTS.map(o => [o.id, o]));
        const out = [base.dashie_cloud, this._piperOption(detection), this._localUrlOption(base.local_url, detection),
                     base.va_default, base.android_voice];
        return out.filter(Boolean);
    },

    /** STT option list in the §3 order: cloud, Whisper (if detected), your-box,
     *  HA pipeline, Android. */
    sttOptions(detection) {
        const base = Object.fromEntries(this.STT.map(o => [o.id, o]));
        const out = [base.dashie_cloud, this._whisperOption(detection), base.local_stt_url,
                     base.va_default, base.android_voice];
        return out.filter(Boolean);
    },

    /** Piper (Home Assistant) engine-direct TTS row — only when a Piper TTS engine
     *  is detected. Provider id is the transport (`ha_engine`), engine carried in
     *  engineId → voice.haTtsEngineId. Voice field is a dropdown from the engine's
     *  voices, else free-text. */
    _piperOption(detection) {
        const eng = this._matchEngine(detection?.tts, /piper/i);
        if (eng) {
            const voices = (eng.voices || []).map(v => ({ value: v.voice_id, label: v.name || v.voice_id }));
            const voiceField = voices.length
                ? { key: 'voice.haTtsVoiceId', label: 'Voice', type: 'select', options: voices }
                : { key: 'voice.haTtsVoiceId', label: 'Voice', placeholder: 'en_US-lessac-medium' };
            return {
                id: 'ha_engine', label: 'Piper (Home Assistant)', locality: 'local', cost: 'Free', haOnly: true,
                engineId: eng.engine_id,
                description: 'Your Home Assistant Piper voice — direct, no Assist pipeline.',
                note: "Local voices don't change per personality — pick one voice here.",
                configFields: [voiceField],
            };
        }
        // Probed HA but no Piper → advertise it as installable (guided deep-link).
        // Detection absent (cloud mode) → hide; haOnly hides it for non-HA accounts.
        if (detection?.available !== true) return null;
        return this._installRow('ha_engine', 'Piper (Home Assistant)', 'core_piper',
            'Free, natural local voices via Home Assistant. Install the Piper add-on to enable.');
    },

    /** Whisper (Home Assistant) engine-direct STT row — selectable when a Whisper STT
     *  engine is detected, else an install row (deep-link) when HA was probed. Provider
     *  id is the transport (`ha_engine`), engine carried in engineId → voice.haSttEngineId. */
    _whisperOption(detection) {
        const eng = this._matchEngine(detection?.stt, /whisper/i);
        if (eng) {
            return {
                id: 'ha_engine', label: 'Whisper (Home Assistant)', locality: 'local', cost: 'Free', haOnly: true,
                engineId: eng.engine_id,
                description: 'Your Home Assistant Whisper speech-to-text — direct, no Assist pipeline.',
            };
        }
        if (detection?.available !== true) return null;
        return this._installRow('ha_engine', 'Whisper (Home Assistant)', 'core_whisper',
            'Free local speech-to-text via Home Assistant. Install the Whisper add-on to enable.');
    },

    /** A not-yet-installed engine row: shown for HA users when detection probed HA but
     *  the engine is absent. Renders an "Install" badge that deep-links to the official
     *  add-on (my.home-assistant.io redirect → the add-on page in the user's OWN HA,
     *  regardless of their URL). Not selectable — click opens install; Re-scan after. */
    _installRow(id, label, addonSlug, description) {
        return {
            id, label, locality: 'local', cost: 'Free', haOnly: true, description,
            install: { addon: addonSlug, url: `https://my.home-assistant.io/redirect/supervisor_addon/?addon=${addonSlug}` },
        };
    },

    /** Local TTS (your box): upgrade the free-text Voice field to a dropdown when
     *  our Kokoro add-on was detected and exposed a voice list; else unchanged. */
    _localUrlOption(base, detection) {
        if (!base) return null;
        const raw = detection?.kokoro?.voices || [];
        const voices = raw.map(v => (typeof v === 'string' ? { value: v, label: v } : { value: v.voice_id, label: v.name || v.voice_id }));
        if (!voices.length) return base;
        const fields = base.configFields.map(f =>
            f.key === 'voice.localTtsVoiceId' ? { ...f, type: 'select', options: voices } : f);
        return { ...base, configFields: fields };
    },

    SEARCH: [
        { id: 'dashie', label: 'Dashie (Tavily)', locality: 'cloud', cost: '~0.8¢/search',
          description: 'Managed web search — no setup.' },
        // SearXNG hidden for MVP (John, 2026-07-12): it's a "your box"-style
        // self-hosted install (no HA add-on to deep-link, no detection) and isn't
        // wired to the runtime yet (search is Tavily-only until the L3 add-on
        // brain). Re-enable by uncommenting — the cards' installGuide support
        // (Install ↗ docs badge on a selectable row) stays in place.
        // { id: 'searxng', label: 'SearXNG (self-hosted)', locality: 'local', cost: 'Free', comingSoon: true,
        //   description: 'Your own metasearch instance — private, no per-search cost.',
        //   installGuide: { url: 'https://docs.searxng.org/admin/installation.html' },
        //   note: 'Enable the JSON API on your instance — add "json" to search.formats in settings.yml — so Dashie can query it.',
        //   configFields: [{ key: 'voice.searxngUrl', label: 'SearXNG instance URL', placeholder: 'http://192.168.1.50:8080' }] },
    ],

    // Sports has a single source today (free ESPN). Listing it makes clear that
    // sports questions don't run through paid web search.
    SPORTS: [
        { id: 'espn', label: 'ESPN', locality: 'cloud', cost: 'Free — not billed',
          description: 'Live scores & schedules. Sports questions use ESPN, not web search.' },
    ],

    // Image-search (Serper / Google Images) per-search cost string for the
    // "Retrieve pictures" toggle. Fallback from the raw catalog ($1/1000,
    // pre-margin); applyLiveRates overwrites with the margined rate card.
    imageSearchCost: '~0.1¢',

    // ── live rate card ───────────────────────────────────────

    /** Overwrite the paid-provider rate strings with the server's rate card
     *  (get_credit_rates), which returns amounts ALREADY MARGINED — what the
     *  user actually pays. The hardcoded strings above are offline fallbacks
     *  and the per-reply "~½–1¢" estimate is intentionally static. Best-effort:
     *  rendering never blocks on failure, and repeat calls are no-ops. */
    _liveRatesApplied: false,
    _liveModelRates: null,   // { modelId: {input, output} } margined per 1M — read by models()
    async applyLiveRates() {
        if (this._liveRatesApplied) return;
        try {
            const res = await window.DashieAuth?.dbRequest('get_credit_rates', {});
            if (res?.models && typeof res.models === 'object') {
                this._liveModelRates = res.models;
            }
            const rates = res?.rates;
            if (!Array.isArray(rates)) return;
            const amt = (svc) => {
                const r = rates.find(x => x.service === svc)?.rates?.[0]?.amount;
                return (typeof r === 'number' && r > 0) ? r : null;
            };
            const tts = amt('tts');   // USD per 1,000 characters
            if (tts) {
                this.TTS.find(o => o.id === 'dashie_cloud').cost =
                    `$${tts.toFixed(2)}/1k chars · ~½–1¢/reply`;
            }
            const search = amt('web_search');   // USD per search
            if (search) {
                this.SEARCH.find(o => o.id === 'dashie').cost = `${this._cents(search)}/search`;
            }
            const image = amt('image_search');  // USD per image search
            if (image) this.imageSearchCost = this._cents(image);
            this._liveRatesApplied = true;
        } catch (e) {
            console.warn('[VoiceAiOptions] rate card unavailable, keeping fallback estimates:', e?.message || e);
        }
    },

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
