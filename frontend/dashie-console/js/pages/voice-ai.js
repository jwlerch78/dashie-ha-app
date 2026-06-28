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
        if (tab !== 'settings' && tab !== 'personalities' && tab !== 'chat' && tab !== 'analysis') return;
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

    // Voice pipeline option sets (account-level). Stored in user_settings; the
    // runtime providers/brain read these in a later phase (storage-first).
    // Control method (engine domain — matches Kotlin VoicePreferences). The third
    // element flags HA-only options, hidden for non-HA accounts. STT/TTS option
    // sets live in window.VoiceAiOptions (voice-ai-options.js), not here.
    CONTROL_METHOD_OPTIONS: [
        ['dashie_cloud', 'Dashie Intelligence'],
        ['voice_assistant', 'Home Assistant Voice Assistant', true],
    ],

    // Realtime "conversation mode" (Gemini Live) — Step 1: a selectable Live
    // model under Dashie Intelligence. Selecting one hides the cascade model/
    // pipeline options it replaces. Speaks in a Google voice (beta). See
    // 20260625_REALTIME_VOICE_CONVERSATION_MODE.md §3.1/§3.2.
    CONVERSATION_MODELS: [
        ['', 'Off — use the standard pipeline'],
        ['gemini-3.1-flash-live-preview', 'Live · Fast (recommended)'],
        ['gemini-2.5-flash-native-audio-latest', 'Live · Expressive'],
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
                ${tab('analysis', 'Dashie Intelligence Analysis')}
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
        await this._fetch();
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

    async _fetch() {
        this._registerSyncOnce();
        this._loading = true;
        this._error = null;
        try {
            const [defaults] = await Promise.all([
                VoiceAiApi.loadAiDefaults(),
                this._fetchPersonalities(),
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
        const STRING_KEYS = ['ai.model', 'voice.controlMethod', 'voice.conversationModel',
            'voice.sttProvider', 'voice.ttsProvider',
            'voice.searchSource', 'voice.sportsSource', 'voice.localLlmUrl', 'voice.localLlmModel',
            'voice.searxngUrl', 'voice.localTtsUrl', 'voice.localSttUrl'];
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

    // ── Component-card handlers ──────────────────────────────

    /** Card option chosen → map the stage to its dotted key and persist. Selecting
     *  the 'local' model stores ai.model='local' (the route); the endpoint + model
     *  live in their own voice.* keys, saved via the inline config fields. */
    selectOption(stageKey, id) {
        const KEY = { model: 'ai.model', stt: 'voice.sttProvider', tts: 'voice.ttsProvider', search: 'voice.searchSource', sports: 'voice.sportsSource' };
        const key = KEY[stageKey];
        if (!key) return;
        this._expandedCards.delete(stageKey);   // collapse back to the chosen option
        this.saveDefault(key, id);
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
        const memoryOn = d['ai.conversationContextEnabled'] === true;
        // The pipeline (TTS/STT/search/sports) is a Dashie Intelligence concept.
        // When the control method is Home Assistant Voice Assistant, HA owns the
        // pipeline, so hide the "Customize pipeline" toggle and its cards.
        const isDashieIntelligence = String(d['voice.controlMethod']) === 'dashie_cloud';
        // Realtime conversation mode (Live model). When ON, the Live model owns
        // STT+LLM+TTS+search, so hide the cascade model/pipeline items it replaces.
        const liveModel = isDashieIntelligence ? String(d['voice.conversationModel'] || '') : '';
        const liveOn = liveModel !== '';
        // "Always use conversation mode": the Live model REPLACES the cascade, so hide
        // the cascade settings (as before). When OFF (on-demand), the cascade still
        // runs for normal wakes — keep its settings visible; the user enters
        // conversation mode by voice ("conversation mode", "go live", …).
        const conversationAlways = liveOn && d['voice.conversationAlways'] === true;
        const customPipeline = d['voice.customizePipeline'] === true;
        const showPipeline = isDashieIntelligence && customPipeline && !conversationAlways;
        const searchOn = d['ai.webSearchEnabled'] === true;
        const cfg = k => d[k];
        const card = (title, stageKey, options, selectedId) => VoiceAiCards.render({
            title, stageKey, options, selectedId,
            expanded: this._expandedCards.has(stageKey),
            anyExpanded: this._expandedCards.size > 0,  // dim the other cards while one is open
            getConfig: cfg,
        });
        return `
            ${this._sectionHeader('Voice & AI Defaults', 'Apply to every device signed into this account.')}
            ${this._renderControlMethodRow(d, customPipeline, isDashieIntelligence && !conversationAlways)}
            ${isDashieIntelligence ? this._renderConversationModeRow(d, liveOn) : ''}

            ${!conversationAlways ? this._renderLocalityLegend() : ''}
            ${!conversationAlways ? card('AI Model', 'model', O.models(), String(d['ai.model'])) : ''}

            ${showPipeline ? card('Text-to-speech (Voice)', 'tts', this._haFilter(O.TTS), String(d['voice.ttsProvider'])) : ''}
            ${showPipeline ? card('Speech-to-text', 'stt', this._haFilter(O.STT), String(d['voice.sttProvider'])) : ''}
            ${showPipeline ? card('Web search source', 'search', O.SEARCH, String(d['voice.searchSource'])) : ''}
            ${showPipeline ? card('Sports source', 'sports', O.SPORTS, String(d['voice.sportsSource'])) : ''}

            ${this._sectionHeader('Tools', '')}
            <div class="card"><div class="card-body">
                ${this._toggleRow('Web search', 'Let the assistant search the web for answers.', 'ai.webSearchEnabled', searchOn)}
                ${this._toggleRow('Retrieve pictures', 'Let the assistant pull family photos into responses.', 'ai.retrievePicturesEnabled', d['ai.retrievePicturesEnabled'])}
                ${this._toggleRow('Conversation memory', 'Remember the prior conversation for follow-ups.', 'ai.conversationContextEnabled', d['ai.conversationContextEnabled'])}
                ${memoryOn ? this._selectRow('Memory duration', 'ai.conversationTimeout', this.MEMORY_OPTIONS, String(d['ai.conversationTimeout'])) : ''}
                ${this._toggleRow('Always use AI for chores', 'Disable the fast path — routes all chore commands through AI (uses more tokens).', 'voice.alwaysUseAI', d['voice.alwaysUseAI'])}
            </div></div>
        `;
    },

    /** Voice control method dropdown with a compact "Customize pipeline" toggle
     *  inline on the right. The toggle reveals the TTS / STT / search-source cards. */
    _renderControlMethodRow(d, customPipeline, showCustomizeToggle) {
        const opts = this._haFilter(this.CONTROL_METHOD_OPTIONS).map(([v, l]) =>
            `<option value="${this._escape(v)}" ${v === String(d['voice.controlMethod']) ? 'selected' : ''}>${this._escape(l)}</option>`).join('');
        // The "Customize pipeline" toggle is only meaningful for Dashie
        // Intelligence — hide it when Home Assistant Voice Assistant is selected.
        const customizeToggle = showCustomizeToggle ? `
                    <div style="display:flex; align-items:center; gap: 8px; padding-bottom: 8px; white-space: nowrap; color: var(--text-secondary); font-size: 13px;">
                        <span>Customize pipeline</span>
                        <label class="toggle">
                            <input type="checkbox" ${customPipeline ? 'checked' : ''}
                                onchange="VoiceAiPage.saveDefault('voice.customizePipeline', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>` : '';
        return `
            <div class="card" style="margin-bottom: 16px;"><div class="card-body">
                <div style="display:flex; align-items:flex-end; gap: 16px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 220px;">
                        <label class="form-label">Voice control method</label>
                        <select class="form-select" onchange="VoiceAiPage.saveDefault('voice.controlMethod', this.value)">${opts}</select>
                    </div>
                    ${customizeToggle}
                </div>
            </div></div>`;
    },

    /** Step-1 realtime "conversation mode" selector — a separate dropdown under
     *  Dashie Intelligence listing the Live models (+ Off). Selecting one switches
     *  to a single Gemini Live model that owns speech+language+search; the caller
     *  hides the now-redundant cascade model/pipeline cards. Google voice (beta). */
    _renderConversationModeRow(d, liveOn) {
        const sel = String(d['voice.conversationModel'] || '');
        const opts = this.CONVERSATION_MODELS.map(([v, l]) =>
            `<option value="${this._escape(v)}" ${v === sel ? 'selected' : ''}>${this._escape(l)}</option>`).join('');
        const always = d['voice.conversationAlways'] === true;
        // "Always use conversation mode" — shown once a Live model is selected.
        // On: the Live model replaces the cascade (settings below hidden).
        // Off: enter conversation mode on demand by voice; the cascade stays active.
        const alwaysToggle = liveOn ? `
                <div class="setting-row" style="align-items:flex-start; padding: 12px 0 0; border-top: 1px solid var(--border, #e5e7eb); margin-top: 12px;">
                    <div style="flex:1; padding-right:12px;">
                        <div class="setting-row-label">Always use conversation mode</div>
                        <div style="font-size:12px; color:var(--text-muted); margin-top:2px; line-height:1.5;">
                            <strong>On:</strong> every request goes straight to realtime conversation — the Live model owns speech, language &amp; search, so the settings below are hidden.<br>
                            <strong>Off:</strong> enter it on demand by saying “conversation mode”, “go live”, or “let’s have a conversation”. The standard pipeline handles everything else, so those settings stay available below.
                        </div>
                    </div>
                    <label class="toggle">
                        <input type="checkbox" ${always ? 'checked' : ''}
                            onchange="VoiceAiPage.saveDefault('voice.conversationAlways', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                </div>` : '';
        const note = liveOn ? `
                <div style="margin-top: 10px; font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
                    ⚡ Realtime conversation (beta). Speaks in a Google voice for now; billed per audio token (see usage).
                </div>` : '';
        return `
            <div class="card" style="margin-bottom: 16px;"><div class="card-body">
                <label class="form-label">Conversation mode (Live · beta)</label>
                <select class="form-select" onchange="VoiceAiPage.saveDefault('voice.conversationModel', this.value)">${opts}</select>
                ${alwaysToggle}
                ${note}
            </div></div>`;
    },

    /** Cloud-vs-local key, shown above the pipeline cards when customize is on. */
    _renderLocalityLegend() {
        const O = window.VoiceAiOptions;
        const dot = (c, label) => `<span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:12px; height:12px; border-radius:3px; background:${c};"></span>${label}</span>`;
        return `
            <div style="display:flex; justify-content:flex-end; gap: 16px; margin: 0 0 8px; font-size: 12px; color: var(--text-secondary);">
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
