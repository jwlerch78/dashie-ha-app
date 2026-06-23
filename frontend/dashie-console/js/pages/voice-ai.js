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
    CONTROL_METHOD_OPTIONS: [
        ['dashie', 'Dashie Cloud (premium AI)'],
        ['ha', 'Home Assistant Voice Assistant'],
    ],
    STT_OPTIONS: [
        ['deepgram', 'Deepgram (recommended)'],
        ['whisper', 'Whisper'],
        ['native', 'Device native'],
    ],
    TTS_OPTIONS: [
        ['elevenlabs', 'ElevenLabs (premium voices)'],
        ['openai', 'OpenAI'],
        ['native', 'Device / Home Assistant (free)'],
    ],

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
        const STRING_KEYS = ['ai.model', 'voice.controlMethod', 'voice.sttProvider', 'voice.ttsProvider'];
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

    /** Household Dashie Cloud sharing toggle — add-on mode only. Lets un-logged-in
     *  tablets / voice satellites on this network use this account's cloud voice
     *  (billed to its credits). Lives under AI Defaults. */
    _renderHouseholdSharing() {
        if (!DashieAuth.isAddonMode) return '';
        const enabled = this._sharing?.householdSharing === true;
        return `
            <div class="section-header" style="margin-top: 32px;">Household Dashie Cloud Sharing</div>
            <div class="card">
                <div class="card-body">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap;">
                        <div style="flex:1; min-width:240px;">
                            <div style="font-weight:500; margin-bottom:6px;">Let kiosk tablets &amp; voice satellites use this account</div>
                            <div style="color: var(--text-secondary); font-size: var(--font-size-sm); line-height:1.5;">
                                When on, un-logged-in Dashie tablets and Home Assistant voice satellites on this network can use this account's Dashie Cloud voice — premium AI answers and personality voices. Usage draws on <strong>your</strong> credits. You can turn this off any time.
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
        const memoryOn = d['ai.conversationContextEnabled'] === true;
        const customPipeline = d['voice.customizePipeline'] === true;
        return `
            ${this._sectionHeader('Voice & AI Defaults', 'Apply to every device signed into this account.')}
            <div class="card"><div class="card-body">
                ${this._selectRow('Voice control method', 'voice.controlMethod', this.CONTROL_METHOD_OPTIONS, String(d['voice.controlMethod']))}
                ${this._modelRow(d['ai.model'])}
                ${this._toggleRow('Customize voice pipeline', 'Override the default speech engines for this account.', 'voice.customizePipeline', customPipeline)}
                ${customPipeline ? this._selectRow('Speech-to-text (STT)', 'voice.sttProvider', this.STT_OPTIONS, String(d['voice.sttProvider'])) : ''}
                ${customPipeline ? this._selectRow('Text-to-speech (TTS)', 'voice.ttsProvider', this.TTS_OPTIONS, String(d['voice.ttsProvider'])) : ''}
                ${this._toggleRow('Web search', 'Let the assistant search the web for answers.', 'ai.webSearchEnabled', d['ai.webSearchEnabled'])}
                ${this._toggleRow('Retrieve pictures', 'Let the assistant pull family photos into responses.', 'ai.retrievePicturesEnabled', d['ai.retrievePicturesEnabled'])}
                ${this._toggleRow('Conversation memory', 'Remember the prior conversation for follow-ups.', 'ai.conversationContextEnabled', d['ai.conversationContextEnabled'])}
                ${memoryOn ? this._selectRow('Memory duration', 'ai.conversationTimeout', this.MEMORY_OPTIONS, String(d['ai.conversationTimeout'])) : ''}
                ${this._toggleRow('Always use AI for chores', 'Disable the fast path — routes all chore commands through AI (uses more tokens).', 'voice.alwaysUseAI', d['voice.alwaysUseAI'])}
            </div></div>
        `;
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
