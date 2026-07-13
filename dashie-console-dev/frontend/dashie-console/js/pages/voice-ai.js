/* ============================================================
   Voice & AI page — account-global settings.

   Two sections:
   1. AI Defaults — the account-wide ai.* settings (model, web
      search, pictures, conversation memory + duration, always-
      use-AI). Persisted to the user_settings blob; apply to every
      surface signed into this account.
   2. Personalities — the household personality catalog: built-in
      templates (with editable family-notes overrides) and custom
      personalities (full CRUD via the editor modal).

   Per-device choices (which personality/voice a given tablet uses,
   control method, pipeline providers) live on the Devices page, not
   here. All data is in Supabase, so this works in cloud and add-on
   mode alike. Gated alpha-only via FeatureGate.
   ============================================================ */

const VoiceAiPage = {
    _defaults: null,        // {dotted: value}
    _engines: null,         // GET /api/voice/engines result — add-on mode only (detection-gated picker)
    _keyStatus: null,       // GET /api/keys/status providers booleans — add-on mode only (preset gating)
    _sharing: null,         // { householdSharing } — add-on mode only (below AI Defaults)
    _templates: null,       // built-in personality rows
    _custom: null,          // custom personality rows
    _overrides: null,       // {template_key: {family_notes}}
    _loading: false,
    _error: null,
    _savingKey: null,       // dotted key currently saving (for inline "saving…")
    _syncRegistered: false,
    _activeTab: 'settings', // 'settings' | 'chat' | 'analysis'
    _expandedCards: new Set(), // expanded component cards (model/stt/tts/search)

    setTab(tab) {
        if (tab !== 'settings' && tab !== 'personalities' && tab !== 'chat' && tab !== 'analysis' && tab !== 'benchmark') return;
        this._activeTab = tab;
        if (tab === 'chat' && typeof VoiceAiChat !== 'undefined' && !VoiceAiChat._open) {
            VoiceAiChat.open();
        }
        App.renderPage();
    },

    // Account-default AI model catalog, grouped by provider. Single source
    // of truth: js/ai/ai-models-catalog.js in dashieapp_staging (bundled
    // into the Console as window.AiModelCatalog at build time). The picker
    // updates automatically when models are added/removed/renamed there —
    // no Console-side edits required, no drift possible.
    get MODEL_GROUPS() {
        if (typeof window.AiModelCatalog === 'undefined') return [];
        return window.AiModelCatalog.dropdownGroups();
    },

    MEMORY_OPTIONS: [
        ['5', '5 minutes'], ['30', '30 minutes'], ['60', '1 hour'],
        ['360', '6 hours'], ['0', 'Never (until refresh)'],
    ],

    // Voice pipeline option sets (account-level) live in window.VoiceAiOptions
    // (voice-ai-options.js): the preset defs (Cloud/Hybrid/Local/HA Assist) and
    // the STT/TTS/search rows. The old controlMethod dropdown and Live/Dialog/
    // Single agent-mode dropdown are replaced by the preset picker + the model
    // card (Live models at top) + the Dialog toggle (Open Brain plan §6).
    // voice.agentMode (live|dialog|single) stays the canonical stored key:
    //   Live model selected in the AI Model card → agentMode='live'
    //   Dialog toggle ON → 'dialog' · OFF → 'single'

    // Live S2S models, grouped at the top of the AI-model card (Cloud preset
    // only — Live is fully cloud + credits). Bound to voice.conversationModel
    // (the Live engine reads it). Speaks in a Google voice (beta).
    // NOTE: "more capable" is a 2.5 model, hence the honest labels.
    CONVERSATION_MODELS: [
        ['gemini-3.1-flash-live-preview', 'Gemini 3.1 Live (faster)'],
        ['gemini-2.5-flash-native-audio-latest', 'Gemini 2.5 Live (more capable)'],
    ],

    /** Drop HA-only voice options (va_default / piper / voice_assistant) for
     *  accounts without Home Assistant. Gated on the live user_profiles.is_ha_user
     *  flag (DashieAuth.isHaUser). Accepts both descriptor objects ({haOnly}) and
     *  the control-method [value, label, haOnly] tuples. */
    _haFilter(options) {
        if (DashieAuth.isHaUser) return options;
        return options.filter(o => Array.isArray(o) ? !o[2] : !o.haOnly);
    },

    render() {
        const editorHtml = (typeof VoiceAiPersonalityEdit !== 'undefined') ? VoiceAiPersonalityEdit.render() : '';
        const tabBar = this._renderTabBar();

        if (this._activeTab === 'chat') {
            // VoiceAiChat owns its own state; just render it under the tab bar.
            const chatHtml = (typeof VoiceAiChat !== 'undefined' && VoiceAiChat._open)
                ? VoiceAiChat.render()
                : `<div style="color: var(--text-muted); padding: 40px 0; text-align: center;">Opening chat…</div>`;
            return `${tabBar}${chatHtml}${editorHtml}`;
        }

        if (this._activeTab === 'analysis') {
            const html = (typeof VoiceAiAnalysis !== 'undefined')
                ? VoiceAiAnalysis.render()
                : `<div style="color: var(--text-muted); padding: 40px 0; text-align: center;">Analysis unavailable.</div>`;
            return `${tabBar}${html}${editorHtml}`;
        }

        if (this._activeTab === 'benchmark') {
            const html = (typeof VoiceAiBenchmark !== 'undefined')
                ? VoiceAiBenchmark.render()
                : `<div style="color: var(--text-muted); padding: 40px 0; text-align: center;">Benchmark unavailable.</div>`;
            return `${tabBar}${html}${editorHtml}`;
        }

        if (!this._defaults && !this._loading && !this._error) {
            this._fetch();
            return `${tabBar}${this._renderLoading()}${editorHtml}`;
        }
        if (this._loading && !this._defaults) return `${tabBar}${this._renderLoading()}${editorHtml}`;
        if (this._error && !this._defaults) return `${tabBar}${this._renderError()}${editorHtml}`;

        if (this._activeTab === 'personalities') {
            return `${tabBar}<div style="max-width: 760px;">${this._renderPersonalities()}</div>${editorHtml}`;
        }
        return `${tabBar}${this._renderMain()}${editorHtml}`;
    },

    /** Tab strip rendered at the top of every Voice & AI sub-view.
     *  Replaces the old "AI Chat Interface" top-bar button. */
    _renderTabBar() {
        const tab = (id, label) => {
            const active = this._activeTab === id;
            return `
                <button onclick="VoiceAiPage.setTab('${id}')"
                    style="background: none; border: none; padding: 10px 4px; cursor: pointer; font-size: 14px; font-weight: ${active ? '600' : '500'};
                           color: ${active ? 'var(--text-primary)' : 'var(--text-muted)'};
                           border-bottom: 2px solid ${active ? 'var(--accent)' : 'transparent'};
                           margin-bottom: -1px;">
                    ${label}
                </button>`;
        };
        return `
            <div style="display: flex; gap: 24px; border-bottom: 1px solid var(--border, #d1d5db); margin-bottom: 20px; max-width: 760px;">
                ${tab('settings', 'Voice & AI Settings')}
                ${tab('personalities', 'Personalities')}
                ${tab('chat', 'AI Chat Interface')}
                ${tab('analysis', 'History')}
                ${tab('benchmark', 'Benchmark')}
            </div>`;
    },

    topBarTitle() { return 'Voice & AI'; },
    topBarSubtitle() { return 'Account-wide AI defaults and personalities'; },

    // Tab strip in _renderTabBar() replaces the old "AI Chat Interface"
    // action button — keeping topBarActions absent so the top-bar UI is
    // empty here (matches every other inline-tabbed page in the Console).

    onNavigateTo() { this._fetch(); },

    async refresh() {
        // The top-bar refresh must reload whatever sub-tab is showing, not just the
        // Settings data. The Analysis tab owns its own server fetch (the intelligence
        // log) — delegate to it so a click pulls fresh interactions.
        if (this._activeTab === 'analysis' && typeof VoiceAiAnalysis !== 'undefined') {
            return VoiceAiAnalysis.refresh();
        }
        if (this._activeTab === 'benchmark' && typeof VoiceAiBenchmark !== 'undefined') {
            return VoiceAiBenchmark.refresh();
        }
        // Top-bar refresh forces a fresh engine scan — so re-detecting after
        // installing a Piper/Whisper add-on is just "refresh the page".
        await this._fetch(true);
    },

    _registerSyncOnce() {
        if (this._syncRegistered || !window.SettingsSync) return;
        this._syncRegistered = true;
        // Personality writes broadcast 'personalities' from the edge handler;
        // refresh the catalog when another surface edits it.
        window.SettingsSync.register('personalities', async () => {
            if (App._currentPage !== 'voice-ai') return;
            await this._fetchPersonalities();
            App.renderPage();
        });
    },

    async _fetch(forceEngines = false) {
        this._registerSyncOnce();
        this._loading = true;
        this._error = null;
        try {
            const [defaults] = await Promise.all([
                VoiceAiApi.loadAiDefaults(),
                this._fetchPersonalities(),
                // Live margined rate card for the TTS/Search cost strings —
                // internally best-effort, falls back to the hardcoded estimates.
                window.VoiceAiOptions?.applyLiveRates?.(),
                // Detection-gated picker: which local STT/TTS engines does HA have?
                // Add-on mode only (decision §11.4). Best-effort — empty on failure.
                // The top-bar refresh forces a fresh scan (bypasses the server cache).
                this._fetchEngines(forceEngines),
                // BYO-key booleans (add-on API Keys page) — gate the Cloud/Hybrid
                // presets on credits OR a key. Best-effort — null on failure.
                this._fetchKeyStatus(),
            ]);
            this._defaults = defaults;
            // Household sharing opt-in lives in the add-on only — fetch it so the
            // toggle below AI Defaults reflects the persisted state. Best-effort.
            if (DashieAuth.isAddonMode) {
                try {
                    const s = await fetch(DashieAuth._addonUrl('/api/settings')).then(r => r.ok ? r.json() : null);
                    this._sharing = s || { householdSharing: false };
                } catch (e) {
                    this._sharing = { householdSharing: false };
                }
            }
            // Piper active but no voice stored (pre-seeding account) → persist
            // amy (low) so the Voice row never renders unset.
            this._seedPiperVoiceIfMissing();
        } catch (e) {
            console.error('[VoiceAiPage] fetch failed:', e);
            this._error = e.message || String(e);
        } finally {
            this._loading = false;
            App.renderPage();
        }
    },

    async _fetchPersonalities() {
        const [templates, custom, overrides] = await Promise.all([
            VoiceAiApi.listTemplates().catch(() => []),
            VoiceAiApi.listCustom().catch(() => []),
            VoiceAiApi.listOverrides().catch(() => []),
        ]);
        this._templates = templates;
        this._custom = custom;
        this._overrides = {};
        for (const o of overrides) this._overrides[o.template_key] = o;
    },

    /** Fetch local voice engine detection (GET /api/voice/engines). Add-on mode
     *  only — a cloud console has no direct line to the user's HA (decision §11.4),
     *  so detection is empty there and the picker shows URL-based local_* rows only.
     *  Best-effort: any failure leaves _engines null (picker degrades, never breaks). */
    /** Fetch local voice engine detection. `force` bypasses the server's 5-min
     *  cache (?refresh=1) — used by the top-bar page refresh so re-scanning after
     *  installing an engine is just the normal refresh. `cache:'no-store'` stops
     *  the browser/ingress serving a stale response (mirrors _probeAddonMode). */
    async _fetchEngines(force = false) {
        if (!DashieAuth.isAddonMode) { this._engines = null; return; }
        try {
            const url = DashieAuth._addonUrl('/api/voice/engines' + (force ? '?refresh=1' : ''));
            const r = await fetch(url, { cache: 'no-store' });
            this._engines = r.ok ? await r.json() : null;
        } catch (e) {
            console.warn('[VoiceAiPage] engine detection unavailable:', e?.message || e);
            this._engines = null;
        }
    },

    /** Which BYO providers have a key on the box (booleans only, never the
     *  keys). Add-on mode only; null elsewhere / on failure — the preset
     *  gate then rests on credits alone. */
    async _fetchKeyStatus() {
        if (!DashieAuth.isAddonMode) { this._keyStatus = null; return; }
        try {
            const r = await fetch(DashieAuth._addonUrl('/api/keys/status'), { cache: 'no-store' });
            this._keyStatus = r.ok ? (await r.json())?.providers || null : null;
        } catch (e) {
            console.warn('[VoiceAiPage] key status unavailable:', e?.message || e);
            this._keyStatus = null;
        }
    },

    getCustom(id) {
        return (this._custom || []).find(p => p.id === id) || null;
    },
    getTemplate(key) {
        return (this._templates || []).find(t => (t.key || t.id) === key) || null;
    },
    overrideNotes(key) {
        return this._overrides?.[key]?.family_notes || '';
    },

    // ── AI default writes ────────────────────────────────────

    async saveDefault(dottedKey, rawValue) {
        // Coerce to the stored type: timeout numeric; model/control-method/STT/TTS
        // are string selects; everything else boolean.
        let value = rawValue;
        const STRING_KEYS = ['ai.model', 'voice.controlMethod', 'voice.conversationModel', 'voice.agentMode',
            'voice.pipelinePreset',   // cloud | hybrid | local | ha_assist (Open Brain §6)
            'ai.defaultPersonalityId', 'ai.defaultVoiceKey',   // account defaults (WS-G Round A)
            'voice.sttProvider', 'voice.ttsProvider',
            'voice.searchSource', 'voice.sportsSource', 'voice.localLlmUrl', 'voice.localLlmModel',
            'voice.searxngUrl', 'voice.localTtsUrl', 'voice.localTtsVoiceId', 'voice.localSttUrl',
            'voice.localLlmKey',   // BYO-model API key (remote endpoints) — WS-I; read server-side by node-io.js
            'voice.hermesUrl',     // Hermes Agent endpoint — WS-I; key lives in the on-box key store (API Keys page)
            // engine-direct HA voice (detection-gated picker, build plan §8)
            'voice.haTtsEngineId', 'voice.haTtsVoiceId', 'voice.haSttEngineId'];
        if (dottedKey === 'ai.conversationTimeout') value = Number(rawValue);
        else if (STRING_KEYS.includes(dottedKey)) value = String(rawValue);
        else value = (rawValue === true || rawValue === 'true');

        const prev = this._defaults[dottedKey];
        this._defaults[dottedKey] = value;
        this._savingKey = dottedKey;
        App.renderPage();
        try {
            await VoiceAiApi.saveAiDefault(dottedKey, value);
        } catch (e) {
            console.error('[VoiceAiPage] save default failed:', e);
            this._defaults[dottedKey] = prev;  // roll back
            Toast.error(Toast.friendly ? Toast.friendly(e, 'save setting') : `Save failed: ${e.message}`);
        } finally {
            this._savingKey = null;
            App.renderPage();
        }
    },

    // ── Preset handling (Open Brain §6) ──────────────────────

    /** The active preset: the stored voice.pipelinePreset, or — for accounts
     *  that predate presets — a display-only derivation from the granular keys
     *  (persisted on the user's first preset click, matching the no-migration
     *  _LEGACY_MAP pattern). */
    _activePreset() {
        const d = this._defaults;
        const stored = String(d['voice.pipelinePreset'] || '');
        if (stored) return stored;
        if (String(d['voice.controlMethod']) === 'voice_assistant') return 'ha_assist';
        const localVoice = String(d['voice.ttsProvider']) !== 'dashie_cloud'
            && String(d['voice.sttProvider']) !== 'dashie_cloud';
        if (['local', 'hermes'].includes(String(d['ai.model'])) && localVoice) return 'local';
        if (localVoice) return 'hybrid';
        return 'cloud';
    },

    /** Cloud & Hybrid need credits OR a BYO AI key; Local & HA Assist are
     *  always available. Optimistic while balances are still loading so the
     *  picker never flash-disables. */
    _presetAvailable(id) {
        const p = window.VoiceAiOptions.PRESETS.find(x => x.id === id);
        if (!p?.needsCreditsOrKey) return true;
        return this._hasCreditsOrKey();
    },

    _hasCreditsOrKey() {
        // Accounts that don't see the credits feature aren't metered from the
        // console's perspective — don't lock their presets.
        if (typeof FeatureGate !== 'undefined' && !FeatureGate.shouldShow('credits')) return true;
        if (this._keyStatus && Object.values(this._keyStatus).some(Boolean)) return true;
        const bal = window.CreditsService?.balance();
        if (!bal || typeof bal.balance !== 'number') return true;   // still loading → optimistic
        return bal.balance > 0;
    },

    /** Preset card clicked. Persists voice.pipelinePreset, keeps the runtime's
     *  engine-domain key (voice.controlMethod) in sync for old APKs, and seeds
     *  any granular provider the new preset filters out — Customize can diverge
     *  afterwards. Explicitly guarded: an unavailable preset never saves
     *  (degradation rule — no silent fall-through to metered usage). */
    selectPreset(id) {
        const O = window.VoiceAiOptions;
        if (!O.PRESETS.some(p => p.id === id)) return;
        if (!this._presetAvailable(id)) return;
        const d = this._defaults;
        this.saveDefault('voice.pipelinePreset', id);
        const cm = id === 'ha_assist' ? 'voice_assistant' : 'dashie_cloud';
        if (String(d['voice.controlMethod']) !== cm) this.saveDefault('voice.controlMethod', cm);

        // Live is Cloud-only (fully cloud + credits) — leaving Cloud drops the
        // agent back to a cascade mode.
        if (id !== 'cloud' && this._agentMode() === 'live') {
            this.saveDefault('voice.agentMode', 'single');
        }
        if (id !== 'ha_assist') {
            // AI model: Local runs the user's own model; Cloud/Hybrid run a cloud
            // model (credits or BYO key — the key routing itself is Phase 2).
            // HA Assist has no Dashie brain → ai.model untouched.
            const model = String(d['ai.model'] || '');
            // 'local' and 'hermes' are both local-family sentinels — entering the
            // Local preset must not clobber a Hermes choice, and leaving it resets
            // either back to the cloud default.
            const isLocalModel = model === 'local' || model === 'hermes';
            if (id === 'local' && !isLocalModel) this.saveDefault('ai.model', 'local');
            if (id !== 'local' && isLocalModel) this.saveDefault('ai.model', VoiceAiApi.DEFAULTS['ai.model']);
        }
        // Voice engines: seed only when the current provider contradicts the
        // preset (it would vanish from the filtered picker otherwise).
        this._seedProvider(id, 'tts', 'voice.ttsProvider');
        this._seedProvider(id, 'stt', 'voice.sttProvider');
    },

    /** Seed a stage's provider to the preset's natural default (John, 2026-07-11):
     *  - Cloud: both stages → dashie_cloud (when the current choice isn't cloud).
     *  - Hybrid: voice goes LOCAL — TTS flips to detected Piper, else Android
     *    voice; STT flips to detected Whisper, else STAYS on Deepgram (Android
     *    STT would be a quality downgrade nobody asked for).
     *  - Local: cloud rows are filtered out, so anything cloud/invalid reseeds
     *    to the detected HA engine, else Android voice.
     *  A current choice that's already valid-and-local for the preset is never
     *  overridden (e.g. own-box Kokoro/Whisper URLs stay picked). */
    _seedProvider(presetId, stageKey, dottedKey) {
        const O = window.VoiceAiOptions;
        const all = stageKey === 'tts' ? O.ttsOptions(this._engines) : O.sttOptions(this._engines);
        const opts = O.presetFilter(presetId, this._haFilter(all)).filter(o => !o.install);
        const current = String(this._defaults[dottedKey] || '');
        const has = id => opts.some(o => o.id === id);
        const currentValid = has(current);
        const hasHaEngine = has('ha_engine');

        if (presetId === 'hybrid') {
            const currentIsLocal = currentValid && current !== 'dashie_cloud';
            if (currentIsLocal) return;   // deliberate local choice — keep it
            if (stageKey === 'tts') {
                this._selectProvider('tts', hasHaEngine ? 'ha_engine' : 'android_voice');
            } else if (hasHaEngine) {
                this._selectProvider('stt', 'ha_engine');
            } else if (!currentValid) {
                this._selectProvider('stt', 'dashie_cloud');
            }
            return;
        }
        if (currentValid) return;
        const seed = presetId === 'cloud' ? 'dashie_cloud'
            : presetId === 'ha_assist' ? 'va_default'   // the Assist pipeline itself
            : (hasHaEngine ? 'ha_engine' : 'android_voice');
        if (!has(seed)) return;
        this._selectProvider(stageKey, seed);
    },

    /** Persist a TTS/STT provider choice, pinning the detected HA engine id
     *  alongside `ha_engine` selections (single-canonical-row decision §11.1). */
    _selectProvider(stageKey, id) {
        const O = window.VoiceAiOptions;
        if (stageKey === 'tts' && id === 'ha_engine') {
            const eng = O.ttsOptions(this._engines).find(o => o.id === 'ha_engine');
            if (eng?.engineId) this.saveDefault('voice.haTtsEngineId', eng.engineId);
            // Piper always has a concrete voice — default amy (low) (John, 2026-07-12).
            if (!String(this._defaults['voice.haTtsVoiceId'] || '')) {
                this.saveDefault('voice.haTtsVoiceId', this._defaultPiperVoice() || 'en_US-amy-low');
            }
        } else if (stageKey === 'stt' && id === 'ha_engine') {
            const eng = O.sttOptions(this._engines).find(o => o.id === 'ha_engine');
            if (eng?.engineId) this.saveDefault('voice.haSttEngineId', eng.engineId);
        }
        this.saveDefault(stageKey === 'tts' ? 'voice.ttsProvider' : 'voice.sttProvider', id);
    },

    /** amy (low) from the detected Piper voice list — the default voice a
     *  Piper selection should always carry. Null when detection is empty. */
    _defaultPiperVoice() {
        const eng = window.VoiceAiOptions.ttsOptions(this._engines).find(o => o.id === 'ha_engine');
        const voices = (eng?.configFields || []).find(f => f.key === 'voice.haTtsVoiceId')?.options || [];
        if (!voices.length) return null;
        const amy = voices.find(v => /amy/i.test(v.value) && /low/i.test(v.value))
            || voices.find(v => /amy/i.test(v.value));
        return (amy || voices[0]).value;
    },

    /** Self-heal for accounts that picked Piper before voice seeding existed
     *  (or whose voice was clobbered): Piper active + no stored voice +
     *  detection has voices → persist amy (low). Runs once per fetch; the
     *  Voice row never shows "— pick a voice —". */
    _seedPiperVoiceIfMissing() {
        const d = this._defaults;
        if (!d || String(d['voice.ttsProvider']) !== 'ha_engine') return;
        if (String(d['voice.haTtsVoiceId'] || '')) return;
        const v = this._defaultPiperVoice();
        if (v) this.saveDefault('voice.haTtsVoiceId', v);
    },

    /** Canonical agent mode (live|dialog|single), deriving the legacy
     *  conversationAlways/conversationModel pair for unmigrated accounts —
     *  mirrors voice-command-router._conversationMode. */
    _agentMode() {
        const d = this._defaults;
        const stored = String(d['voice.agentMode'] || '');
        if (stored) return stored;
        const always = d['voice.conversationAlways'] === true;
        const lm = String(d['voice.conversationModel'] || '');
        return always ? (lm ? 'live' : 'dialog') : 'single';
    },

    /** Dialog toggle (shown when a non-Live model is selected):
     *  ON → conversation dialog (mic stays open) · OFF → single response. */
    setDialogMode(on) {
        this.saveDefault('voice.agentMode', on ? 'dialog' : 'single');
    },

    // ── Component-card handlers ──────────────────────────────

    /** Card option chosen → map the stage to its dotted key and persist.
     *  The model card mixes Live models (top group, Cloud preset) with cascade
     *  models: picking a Live model sets agentMode='live' + conversationModel
     *  (ai.model untouched); picking a cascade model saves ai.model and drops
     *  a live agent back to single (the Dialog toggle re-enables dialog). */
    selectOption(stageKey, id) {
        this._expandedCards.delete(stageKey);   // collapse back to the chosen option
        if (stageKey === 'model') {
            const isLiveModel = this.CONVERSATION_MODELS.some(([v]) => v === id);
            if (isLiveModel) {
                if (this._agentMode() !== 'live') this.saveDefault('voice.agentMode', 'live');
                this.saveDefault('voice.conversationModel', id);
            } else {
                if (this._agentMode() === 'live') this.saveDefault('voice.agentMode', 'single');
                this.saveDefault('ai.model', id);
            }
            return;
        }
        if (stageKey === 'tts' || stageKey === 'stt') {
            this._selectProvider(stageKey, id);
            return;
        }
        if (stageKey === 'search') {
            // 'None' replaces the old Web-search toggle: it maps to
            // ai.webSearchEnabled=false (searchSource untouched, so switching
            // back restores the prior provider). 'google' is display-only (the
            // Gemini-grounding pseudo-source) — never persisted as a source.
            if (id === 'none') {
                this.saveDefault('ai.webSearchEnabled', false);
                return;
            }
            if (this._defaults['ai.webSearchEnabled'] !== true) this.saveDefault('ai.webSearchEnabled', true);
            if (id !== 'google') this.saveDefault('voice.searchSource', id);
            return;
        }
        if (stageKey === 'sports') this.saveDefault('voice.sportsSource', id);
    },

    /** Inline local-config field (endpoint URL, model, SearXNG URL) → persist as string. */
    saveLocalField(dottedKey, value) {
        this.saveDefault(dottedKey, value);
    },

    /** Expand/collapse a component card. */
    toggleCard(stageKey) {
        if (this._expandedCards.has(stageKey)) this._expandedCards.delete(stageKey);
        else this._expandedCards.add(stageKey);
        App.renderPage();
    },

    // ── Personality actions ──────────────────────────────────

    async deleteCustom(id) {
        const p = this.getCustom(id);
        const ok = await ConfirmModal.confirm({
            title: 'Delete personality',
            message: `"${p?.name || 'This personality'}" will be removed from your account. Any device using it falls back to Dashie.`,
            confirmLabel: 'Delete',
            danger: true,
        });
        if (!ok) return;
        try {
            await VoiceAiApi.deletePersonality(id);
            Toast.info(`Deleted "${p?.name || 'personality'}"`);
            await this._fetchPersonalities();
            App.renderPage();
        } catch (e) {
            console.error('[VoiceAiPage] delete failed:', e);
            Toast.error(`Delete failed: ${e.message}`);
        }
    },

    // ── Render ───────────────────────────────────────────────

    _renderMain() {
        // Personalities moved to its own tab; this is the Voice & AI Settings tab.
        return `
            <div style="max-width: 760px;">
                ${this._renderAiDefaults()}
                ${this._renderHouseholdSharing()}
            </div>
        `;
    },

    /** Household Dashie Intelligence sharing toggle — add-on mode only. Lets un-logged-in
     *  tablets / voice satellites on this network use this account's cloud voice
     *  (billed to its credits). Lives under AI Defaults. */
    _renderHouseholdSharing() {
        if (!DashieAuth.isAddonMode) return '';
        const enabled = this._sharing?.householdSharing === true;
        return `
            <div class="section-header" style="margin-top: 32px;">Household Dashie Intelligence Sharing</div>
            <div class="card">
                <div class="card-body">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap;">
                        <div style="flex:1; min-width:240px;">
                            <div style="font-weight:500; margin-bottom:6px;">Let kiosk tablets &amp; voice satellites use this account</div>
                            <div style="color: var(--text-secondary); font-size: var(--font-size-sm); line-height:1.5;">
                                When on, un-logged-in Dashie tablets and Home Assistant voice satellites on this network can use this account's Dashie Intelligence voice — premium AI answers and personality voices. Usage draws on <strong>your</strong> credits. You can turn this off any time.
                            </div>
                        </div>
                        <button class="btn ${enabled ? 'btn-primary' : 'btn-secondary'}" id="household-sharing-btn"
                            onclick="VoiceAiPage.toggleHouseholdSharing(${!enabled})" style="flex-shrink:0;">
                            ${enabled ? 'Sharing On' : 'Sharing Off'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    async toggleHouseholdSharing(enabled) {
        try {
            const resp = await fetch(DashieAuth._addonUrl('/api/settings/household-sharing'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this._sharing = { householdSharing: data.householdSharing };
            App.renderPage();
        } catch (e) {
            console.error('[VoiceAiPage] Toggle household sharing failed:', e);
            Toast.error('Could not update sharing setting: ' + e.message);
        }
    },

    _renderAiDefaults() {
        const d = this._defaults;
        const O = window.VoiceAiOptions;
        const preset = this._activePreset();
        const isHaAssist = preset === 'ha_assist';
        const agentMode = this._agentMode();
        // Live (S2S) owns STT+LLM+TTS+search, so hide the cascade pipeline cards
        // it replaces. Dialog + Single both run the cascade → keep them shown.
        // HA Assist keeps Customize too (mix the Assist pipeline with e.g. the
        // local Android voice) — just without the Dashie-brain cards.
        const isLive = !isHaAssist && agentMode === 'live';
        const customPipeline = d['voice.customizePipeline'] === true;
        const showPipeline = customPipeline && !isLive;
        // Gemini cascade models search via native Google grounding (not Tavily) → the
        // Web-search-source card shows "Google" instead. Applies in dialog/single.
        const isGeminiAiModel = String(d['ai.model'] || '').startsWith('gemini-');
        const searchOn = d['ai.webSearchEnabled'] === true;
        // Prune expanded-state for cards that are no longer rendered (Customize
        // off, preset switch, Live hiding the pipeline). A stale entry keeps
        // anyExpanded true and dims every visible card indefinitely.
        const visibleStages = new Set(isHaAssist
            ? (showPipeline ? ['tts', 'stt'] : [])
            : ['model', ...(showPipeline ? ['tts', 'stt', 'search'] : [])]);
        for (const k of [...this._expandedCards]) {
            if (!visibleStages.has(k)) this._expandedCards.delete(k);
        }
        const cfg = k => d[k];
        // WS-F (§13.1): stage icons on the three pipeline card titles — brain (AI),
        // ear (STT), speaking head (TTS). Other cards (search, defaults) stay bare.
        const CARD_ICONS = { model: 'icon-ai-brain', stt: 'icon-ear', tts: 'icon-speaking-head', search: 'icon-search' };
        const card = (title, stageKey, options, selectedId) => VoiceAiCards.render({
            title, stageKey, options, selectedId,
            icon: CARD_ICONS[stageKey] || '',
            expanded: this._expandedCards.has(stageKey),
            anyExpanded: this._expandedCards.size > 0,  // dim the other cards while one is open
            getConfig: cfg,
        });
        const filtered = (stage, all) => O.presetFilter(preset, this._haFilter(all));
        const P = window.VoiceAiPresetPicker;
        const D = window.VoiceAiDefaultsCards;
        // Web search: the toggle is gone (John, 2026-07-12) — "None" is a
        // source-card option instead. Selection maps webSearchEnabled + source.
        const searchOptions = [
            ...(isGeminiAiModel ? this._googleSearchOption() : filtered('search', O.SEARCH)),
            { id: 'none', label: 'None', cost: '', description: 'Web search off — Dashie answers without searching the web.' },
        ];
        const searchSelected = !searchOn ? 'none' : (isGeminiAiModel ? 'google' : String(d['voice.searchSource']));
        // Voice split out of the TTS card (John, 2026-07-12): the voice-id
        // config field renders as its own row under Text-to-speech, only for
        // engines with a selectable voice (Piper ha_engine / Kokoro local_url).
        // The URL/other fields stay in the card.
        const VOICE_FIELD_KEYS = ['voice.haTtsVoiceId', 'voice.localTtsVoiceId'];
        const ttsAll = filtered('tts', O.ttsOptions(this._engines));
        const ttsSelected = ttsAll.find(x => x.id === String(d['voice.ttsProvider'])) || null;
        const voiceField = (ttsSelected && ['ha_engine', 'local_url'].includes(ttsSelected.id))
            ? (ttsSelected.configFields || []).find(f => VOICE_FIELD_KEYS.includes(f.key)) || null
            : null;
        const ttsCardOpts = ttsAll.map(x => {
            if (!x.configFields) return x;
            const rest = x.configFields.filter(f => !VOICE_FIELD_KEYS.includes(f.key));
            return { ...x, configFields: rest.length ? rest : undefined };
        });
        // HA Assist: the link-out card + customizable STT/TTS (mix the Assist
        // pipeline with local engines/Android voice) — no Dashie-brain cards
        // (model/personality/search) since HA owns the conversation agent.
        const body = isHaAssist ? `
            ${P.renderHaAssistCard()}
            ${P.renderCustomizeRow(customPipeline, true)}
            ${showPipeline ? card('Text-to-speech', 'tts', ttsCardOpts, String(d['voice.ttsProvider'])) : ''}
            ${showPipeline && voiceField ? this._renderVoiceRow(voiceField, d) : ''}
            ${showPipeline ? card('Speech-to-text', 'stt', filtered('stt', O.sttOptions(this._engines)), String(d['voice.sttProvider'])) : ''}` : `
            ${P.renderCustomizeRow(customPipeline, !isLive)}
            ${card('AI Model', 'model', this._markKeyed(this._modelOptions(preset)), this._selectedModelId(agentMode))}
            ${D.renderPersonalityCard({
                templates: this._templates, custom: this._custom,
                currentId: String(d['ai.defaultPersonalityId'] || 'dashie'),
                saving: this._savingKey === 'ai.defaultPersonalityId',
            })}
            ${isLive ? P.renderLiveNote() : ''}
            ${showPipeline ? this._renderEngineDetectionRow() : ''}
            ${showPipeline ? card('Text-to-speech', 'tts', ttsCardOpts, String(d['voice.ttsProvider'])) : ''}
            ${showPipeline && voiceField ? this._renderVoiceRow(voiceField, d) : ''}
            ${showPipeline ? card('Speech-to-text', 'stt', filtered('stt', O.sttOptions(this._engines)), String(d['voice.sttProvider'])) : ''}
            ${showPipeline ? card('Web search source', 'search', this._markKeyed(searchOptions), searchSelected) : ''}`;
            // Sports source card hidden for now (John, 2026-07-11) — ESPN is the
            // only option. The account default-VOICE card was removed 2026-07-12
            // (cloud voice follows the personality; Piper voice lives in the TTS
            // card's config; per-device override on the Devices page).
        return `
            <div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin: 20px 0 10px;">
                <div style="font-size: 15px; font-weight: 600;">Voice &amp; AI Defaults</div>
                ${this._renderLocalityLegend()}
            </div>
            ${VoiceAiPresetPicker.render({
                presets: this._haFilter(O.PRESETS),
                selectedId: preset,
                available: (id) => this._presetAvailable(id),
                isAddonMode: DashieAuth.isAddonMode,
            })}
            ${body}

            ${isHaAssist ? '' : `
            ${this._sectionHeader('AI Tools & Settings', '')}
            <div class="card"><div class="card-body">
                ${!isLive ? this._renderDialogRows(d, agentMode) : ''}
                ${this._toggleRow('Retrieve pictures', `Allow the AI to show pictures with its responses. Uses web image search (${O.imageSearchCost}/search).`, 'ai.retrievePicturesEnabled', d['ai.retrievePicturesEnabled'])}
                ${FeatureGate.shouldShow('chores') ? this._toggleRow('Always use AI for chores', 'Disable the fast path — routes all chore commands through AI (uses more tokens).', 'voice.alwaysUseAI', d['voice.alwaysUseAI']) : ''}
            </div></div>`}
        `;
        // Conversation memory (+ duration) hidden for now (John, 2026-07-12) —
        // not in use yet. Re-add via ai.conversationContextEnabled /
        // ai.conversationTimeout toggle+select rows when it ships.
    },

    /** The Voice row under Text-to-speech (Piper/Kokoro only): a detection-
     *  populated dropdown rendered borderless-bold to match the compact rows,
     *  or a plain text input when no voice list is available. */
    _renderVoiceRow(voiceField, d) {
        const D = window.VoiceAiDefaultsCards;
        const cur = String(d[voiceField.key] || '');
        let control;
        let caret = true;
        if (voiceField.type === 'select' && Array.isArray(voiceField.options)) {
            // Never render unset — an empty stored value displays as the default
            // voice (amy (low) for Piper); _seedPiperVoiceIfMissing persists it.
            const effective = cur
                || (voiceField.key === 'voice.haTtsVoiceId' ? this._defaultPiperVoice() : '')
                || voiceField.options[0]?.value || '';
            const known = voiceField.options.some(v => v.value === effective);
            const opts = [
                ...voiceField.options.map(v =>
                    `<option value="${this._escape(v.value)}" ${v.value === effective ? 'selected' : ''}>${this._escape(v.label)}</option>`),
                (effective && !known) ? `<option value="${this._escape(effective)}" selected>${this._escape(effective)} (current)</option>` : '',
            ].join('');
            control = `<select style="${D.SELECT_STYLE}" onchange="VoiceAiPage.saveLocalField('${voiceField.key}', this.value)">${opts}</select>`;
        } else {
            caret = false;
            control = `<input type="text" value="${this._escape(cur)}" placeholder="${this._escape(voiceField.placeholder || '')}"
                autocomplete="off" onchange="VoiceAiPage.saveLocalField('${voiceField.key}', this.value)"
                style="flex: 1; padding: 7px 9px; border: 1px solid var(--border, #d1d5db); border-radius: 5px; font-size: 13px;">`;
        }
        return D.renderControlRow({
            label: 'Voice',
            icon: 'icon-voice',
            saving: this._savingKey === voiceField.key,
            controlHtml: control,
            caret,
        });
    },

    /** Reachability test for the own-box engine URLs (Local TTS / Local
     *  Whisper). Add-on mode proxies through the box (the browser can't reach
     *  a LAN engine cross-origin); elsewhere a best-effort direct fetch. */
    async testLocalUrl(fieldKey, kind, btn) {
        const input = document.getElementById(`cfg-${fieldKey}`);
        const url = String(input?.value || this._defaults?.[fieldKey] || '').trim();
        if (!url) { Toast.info('Enter the URL first.'); return; }
        const restore = () => { if (btn) { btn.disabled = false; btn.textContent = 'Test'; } };
        if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }
        try {
            let result;
            if (DashieAuth.isAddonMode) {
                const r = await fetch(DashieAuth._addonUrl('/api/voice/probe'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, kind }),
                });
                // A 404 = the add-on predates the probe endpoint — fall through
                // to a direct attempt rather than reporting a bogus failure.
                result = r.status === 404 ? null : await r.json();
            }
            if (!result) {
                const path = kind === 'tts' ? '/v1/audio/voices' : '/v1/models';
                const r = await fetch(url.replace(/\/+$/, '') + path, { signal: AbortSignal.timeout(5000) });
                result = { ok: r.ok, detail: `HTTP ${r.status}` };
            }
            if (result.ok) Toast.success(`Reachable ✓ ${result.detail || ''}`);
            else Toast.error(`Not reachable — ${result.detail || 'no response'}`);
        } catch (e) {
            Toast.error(`Not reachable — ${e?.message || e}`);
        }
        restore();
    },

    /** Conversation-dialog rows at the top of AI Tools & Settings (moved from
     *  their own card, 2026-07-12): the Dialog toggle (agentMode dialog/single)
     *  + the "Open dialog after commands" sub-option while it's on. Hidden for
     *  Live (built into the model) and HA Assist. */
    _renderDialogRows(d, agentMode) {
        const dialogOn = agentMode === 'dialog';
        const saving = this._savingKey === 'voice.agentMode';
        return `
            <div class="setting-row" style="align-items: flex-start; padding: 10px 0;">
                <div style="flex: 1; padding-right: 12px;">
                    <div class="setting-row-label">Conversation dialog ${saving ? '<span style="color: var(--text-muted);">· saving…</span>' : ''}</div>
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Keep the mic open after a reply so you can keep talking — no wake word needed. Off = one response per “Hey Dashie”.</div>
                </div>
                <label class="toggle">
                    <input type="checkbox" ${dialogOn ? 'checked' : ''}
                        onchange="VoiceAiPage.setDialogMode(this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </div>
            ${dialogOn ? this._toggleRow('Open dialog after commands', 'Keep listening after every command — not just questions — without saying “Hey Dashie” again.', 'voice.alwaysOpenDialog', d['voice.alwaysOpenDialog']) : ''}`;
    },

    /** The AI Model card's option list for the active preset: Live models
     *  grouped at the top (Cloud preset only — Live is fully cloud + credits),
     *  then the preset-filtered catalog (Local → the own-AI row; Cloud/Hybrid →
     *  cloud provider groups). */
    _modelOptions(preset) {
        const O = window.VoiceAiOptions;
        const catalog = O.presetFilter(preset, O.models());
        if (preset !== 'cloud') return catalog;
        const live = this._liveModelOptions().map(o => ({ ...o, group: 'Live · realtime conversation' }));
        return [...live, ...catalog];
    },

    /** Selected id for the AI Model card: the Live model while agentMode='live',
     *  else the cascade model. */
    _selectedModelId(agentMode) {
        const d = this._defaults;
        if (agentMode === 'live') return String(d['voice.conversationModel'] || this.CONVERSATION_MODELS[0][0]);
        return String(d['ai.model']);
    },

    /** Live S2S models in the same option shape as O.models() so the AI-model card
     *  renders identically (orange CLOUD cards). Cost prefers the live margined
     *  rate card (what the user pays), falling back to the bundled raw catalog. */
    _liveModelOptions() {
        const O = window.VoiceAiOptions, C = window.AiModelCatalog;
        return this.CONVERSATION_MODELS.map(([id, label]) => {
            const live = O?._liveModelRates?.[id];
            const p = live ? [live.input, live.output] : C?.pricingFor?.(id);   // [inPer1M, outPer1M] | null
            return {
                id, label, locality: 'cloud',
                cost: p ? O._modelCost(p) : '',
                description: id.startsWith('gemini-3.1') ? 'Fastest realtime voice.' : 'More capable realtime voice.',
            };
        });
    },

    /** Web-search "source" shown when a Gemini model is selected: native Google Search
     *  grounding (the model searches Google directly — no Tavily). Fixed, single option. */
    _googleSearchOption() {
        return [{
            id: 'google', label: 'Google', locality: 'cloud', cost: 'Included with Gemini',
            description: 'Gemini searches Google directly and grounds its answer.',
            // Google grounding is part of the Gemini model call, so it runs through
            // the same BYO Gemini key — mark it with the provider so it shows keyed too.
            provider: 'gemini',
        }];
    },

    /** Mark options whose provider has a BYO key stored on the box (Open Brain §5).
     *  A `keyed` option shows the key icon + "API account" instead of a per-turn
     *  cost — its turns run on the user's key, not Dashie credits. No-op off add-on
     *  mode / when no keys are set (this._keyStatus null). */
    _markKeyed(options) {
        const ks = this._keyStatus;
        if (!ks) return options;
        return options.map(o => (o.provider && ks[o.provider]) ? { ...o, keyed: true } : o);
    },

    /** Detection status + "Re-scan" for the engine-direct HA rows. Add-on mode
     *  only (detection is add-on-only, §11.4). Tells the user whether local
     *  engines were found and lets them re-probe after installing Piper/Whisper. */
    _renderEngineDetectionRow() {
        if (!DashieAuth.isAddonMode) return '';
        // Only the failure case gets a line — when detection works, the
        // Piper/Whisper rows speak for themselves (hint removed 2026-07-12).
        const e = this._engines;
        if (e && e.available) return '';
        return `
            <div style="margin: 0 0 8px; font-size: 12px; color: var(--text-secondary);">
                ${this._escape('Home Assistant not reachable — showing your-box (URL) options only.')}
            </div>`;
    },

    /** Cloud-vs-local color key — rendered inline in the section-title row,
     *  right of "Voice & AI Defaults" (moved above the preset cards 2026-07-12). */
    _renderLocalityLegend() {
        const O = window.VoiceAiOptions;
        const dot = (c, label) => `<span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:12px; height:12px; border-radius:3px; background:${c};"></span>${label}</span>`;
        return `
            <div style="display:flex; gap: 16px; font-size: 12px; color: var(--text-secondary);">
                ${dot(O.COLOR.cloud, 'Cloud')}
                ${dot(O.COLOR.local, 'Local')}
            </div>`;
    },

    _renderPersonalities() {
        const templates = this._templates || [];
        const custom = this._custom || [];
        return `
            ${this._sectionHeader('Personalities', 'Shared across the household. Pick which one a device uses on the Devices page.')}
            <div style="display: flex; justify-content: flex-end; margin-bottom: 8px;">
                <button class="btn btn-primary btn-sm" onclick="VoiceAiPersonalityEdit.openNew()">+ New Personality</button>
            </div>
            <div class="card"><div class="card-body" style="padding: 0;">
                ${custom.length ? `<div style="padding: 12px 16px 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);">Custom</div>` : ''}
                ${custom.map(p => this._personalityRow(p, true)).join('')}
                <div style="padding: 12px 16px 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);">Built-in</div>
                ${templates.map(t => this._personalityRow(t, false)).join('')}
            </div></div>
        `;
    },

    _personalityRow(p, isCustom) {
        const id = this._escape(isCustom ? p.id : (p.key || p.id));
        // Voice name intentionally hidden here — matches the tablet's Voice & AI menu,
        // which doesn't surface the underlying voice on the personality list.
        const notes = isCustom ? '' : this.overrideNotes(p.key || p.id);
        const subtitle = [p.description || '', notes ? '✏️ family notes set' : '']
            .filter(Boolean).join(' · ');

        const actions = isCustom
            ? `<button class="btn btn-ghost btn-sm" onclick="VoiceAiPersonalityEdit.openEdit('${id}')">Edit</button>
               <button class="btn btn-ghost btn-sm" title="Delete" onclick="VoiceAiPage.deleteCustom('${id}')">🗑</button>`
            : `<button class="btn btn-ghost btn-sm" onclick="VoiceAiPersonalityEdit.openOverride('${id}')">Family notes</button>`;

        return `
            <div class="list-item" style="border-top: 1px solid var(--border, #e5e7eb);">
                <div class="list-item-content">
                    <div class="list-item-title">${this._escape(p.name)}${isCustom ? '' : ' <span class="list-item-badge">built-in</span>'}</div>
                    ${subtitle ? `<div class="list-item-subtitle">${this._escape(subtitle)}</div>` : ''}
                </div>
                ${actions}
            </div>
        `;
    },

    _sectionHeader(title, sub) {
        return `
            <div style="margin: 20px 0 10px;">
                <div style="font-size: 15px; font-weight: 600;">${title}</div>
                ${sub ? `<div style="font-size: 13px; color: var(--text-muted);">${sub}</div>` : ''}
            </div>
        `;
    },

    _modelRow(current) {
        const saving = this._savingKey === 'ai.model';
        const groups = this.MODEL_GROUPS.map(([label, opts]) => `
            <optgroup label="${this._escape(label)}">
                ${opts.map(([v, l]) => `<option value="${this._escape(v)}" ${v === current ? 'selected' : ''}>${this._escape(l)}</option>`).join('')}
            </optgroup>
        `).join('');
        return `
            <div class="form-group">
                <label class="form-label">AI model ${saving ? '<span style="color: var(--text-muted); font-weight: 400;">· saving…</span>' : ''}</label>
                <select class="form-select" onchange="VoiceAiPage.saveDefault('ai.model', this.value)">${groups}</select>
            </div>
        `;
    },

    _selectRow(label, dottedKey, options, current) {
        const saving = this._savingKey === dottedKey;
        const opts = options.map(([v, l]) =>
            `<option value="${this._escape(v)}" ${v === String(current) ? 'selected' : ''}>${this._escape(l)}</option>`).join('');
        return `
            <div class="form-group">
                <label class="form-label">${this._escape(label)} ${saving ? '<span style="color: var(--text-muted); font-weight: 400;">· saving…</span>' : ''}</label>
                <select class="form-select" onchange="VoiceAiPage.saveDefault('${dottedKey}', this.value)">${opts}</select>
            </div>
        `;
    },

    _toggleRow(label, sub, dottedKey, checked) {
        const saving = this._savingKey === dottedKey;
        return `
            <div class="setting-row" style="align-items: flex-start; padding: 10px 0;">
                <div style="flex: 1; padding-right: 12px;">
                    <div class="setting-row-label">${this._escape(label)} ${saving ? '<span style="color: var(--text-muted);">· saving…</span>' : ''}</div>
                    ${sub ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">${this._escape(sub)}</div>` : ''}
                </div>
                <label class="toggle">
                    <input type="checkbox" ${checked ? 'checked' : ''}
                        onchange="VoiceAiPage.saveDefault('${dottedKey}', this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </div>
        `;
    },

    _renderLoading() {
        return `<div class="empty-state" style="margin-top: 80px;"><div class="empty-state-text">Loading…</div></div>`;
    },

    _renderError() {
        return `
            <div class="empty-state" style="margin-top: 80px;">
                <div class="empty-state-icon">⚠️</div>
                <div class="empty-state-text">Could not load Voice & AI settings</div>
                <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin: 8px 0 16px;">${this._escape(this._error)}</div>
                <button class="btn btn-secondary" onclick="VoiceAiPage._fetch()">Retry</button>
            </div>
        `;
    },

    _escape(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
};
