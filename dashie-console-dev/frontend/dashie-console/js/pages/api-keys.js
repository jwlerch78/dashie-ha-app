/* ============================================================
   API Keys Page (add-on console only)
   ------------------------------------------------------------
   BYO model-provider keys for the AI/brain (Open Brain plan
   20260710_OPEN_BRAIN_BYOK_PRESETS_UI.md §4). Keys are stored on
   the HA box's add-on /data volume via GET/PUT /api/keys — never
   in Supabase, never synced. The server returns masked values
   (last 4) and set-flags; full keys never round-trip back here.

   Gated on add-on mode (FeatureGate 'apiKeys' → 'addon'); in the
   cloud/website console the page and its nav item don't exist.

   Phase 1 = storage + UI only. Brain routing (device picks the
   add-on brain when a key exists) is Phase 2.
   ============================================================ */

const ApiKeysPage = {
    _providers: null,     // { gemini: {set, fields}, ... } — masked view from GET /api/keys
    _loading: false,
    _error: null,
    _busy: null,          // provider id currently saving/removing

    /** AI/brain providers (v1). `fields` drive the form; single-key providers
     *  use one masked input, Bedrock is multi-field. */
    PROVIDERS: [
        {
            id: 'gemini', name: 'Google Gemini',
            help: 'API key from Google AI Studio (aistudio.google.com). Used for Gemini models.',
            fields: [{ id: 'key', label: 'API key', placeholder: 'AIza…', secret: true }],
        },
        {
            id: 'claude', name: 'Anthropic Claude',
            help: 'API key from console.anthropic.com. Used for Claude models.',
            fields: [{ id: 'key', label: 'API key', placeholder: 'sk-ant-…', secret: true }],
        },
        {
            id: 'openai', name: 'OpenAI',
            help: 'API key from platform.openai.com. Used for GPT models.',
            fields: [{ id: 'key', label: 'API key', placeholder: 'sk-…', secret: true }],
        },
        {
            id: 'bedrock', name: 'Amazon Bedrock',
            help: 'AWS IAM credentials with Bedrock access. All three fields are required.',
            fields: [
                { id: 'accessKeyId', label: 'Access key ID', placeholder: 'AKIA…', secret: true },
                { id: 'secretAccessKey', label: 'Secret access key', placeholder: '', secret: true },
                { id: 'region', label: 'Region', placeholder: 'us-east-1', secret: false },
            ],
        },
        {
            id: 'hermes', name: 'Hermes',
            help: 'API key for your self-hosted Hermes agent. Set its endpoint URL under Voice & AI → AI Model → “Hermes Agent”.',
            fields: [{ id: 'key', label: 'API key', placeholder: '', secret: true }],
        },
    ],

    /** Voice/search BYO keys are deferred (local Whisper/Piper already covers
     *  “own voice”) — listed so users know they're on the radar. */
    COMING_SOON: ['Deepgram (STT)', 'ElevenLabs (TTS)', 'Tavily (web search)'],

    topBarTitle() { return 'API Keys'; },
    topBarSubtitle() { return ''; },

    onNavigateTo() { this._fetch(); },
    async refresh() { await this._fetch(); },

    async _fetch() {
        if (typeof DashieAuth === 'undefined' || !DashieAuth.isAddonMode) return;
        this._loading = true;
        this._error = null;
        App.renderPage();
        try {
            const resp = await fetch(DashieAuth._addonUrl('/api/keys'));
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this._providers = data?.providers || {};
        } catch (e) {
            console.error('[ApiKeysPage] fetch failed:', e);
            this._error = e?.message || String(e);
        }
        this._loading = false;
        App.renderPage();
    },

    render() {
        if (typeof DashieAuth === 'undefined' || !DashieAuth.isAddonMode) {
            return `
                <div class="card" style="max-width: 800px;"><div class="card-body" style="color: var(--text-secondary);">
                    API keys are stored on your Home Assistant box and managed from the Dashie Console add-on there.
                </div></div>`;
        }
        if (!this._providers && !this._loading && !this._error) {
            this._fetch();
            return `<div style="max-width: 800px; color: var(--text-muted); padding: 20px 0;">Loading…</div>`;
        }
        if (this._loading && !this._providers) {
            return `<div style="max-width: 800px; color: var(--text-muted); padding: 20px 0;">Loading…</div>`;
        }
        if (this._error && !this._providers) {
            return `
                <div class="card" style="max-width: 800px;"><div class="card-body" style="color: var(--status-error, #c00);">
                    Couldn't load API keys: ${this._escape(this._error)}
                    <button class="btn btn-secondary btn-sm" style="margin-left: 12px;" onclick="ApiKeysPage._fetch()">Retry</button>
                </div></div>`;
        }
        return `
            <div style="max-width: 800px;">
                <div style="margin-bottom: 20px; color: var(--text-secondary); font-size: var(--font-size-sm); line-height: 1.5;">
                    Bring your own AI: add a model-provider key and Dashie can run its brain on your
                    account instead of Dashie credits. Keys are stored <strong>only on this Home
                    Assistant box</strong> — they never leave it and are never synced to Dashie Cloud.
                </div>
                <div class="section-header">AI providers</div>
                ${this.PROVIDERS.map(p => this._renderProviderCard(p)).join('')}
                <div class="section-header" style="margin-top: 28px;">Coming later</div>
                <div class="card"><div class="card-body" style="color: var(--text-muted); font-size: 13px; line-height: 1.6;">
                    ${this.COMING_SOON.join(' · ')} — bring-your-own voice/search keys are planned.
                    Local voice (Whisper/Piper) already runs key-free under Voice &amp; AI.
                </div></div>
            </div>`;
    },

    _renderProviderCard(p) {
        const state = this._providers?.[p.id] || { set: false, fields: {} };
        const busy = this._busy === p.id;
        const pill = state.set
            ? `<span style="font-size: 11px; font-weight: 700; color: var(--status-success, #16a34a); background: rgba(22,163,74,0.10); border-radius: 999px; padding: 3px 10px;">Key saved</span>`
            : `<span style="font-size: 11px; font-weight: 600; color: var(--text-muted); background: var(--bg-muted, #f4f4f5); border-radius: 999px; padding: 3px 10px;">Not set</span>`;
        const inputs = p.fields.map(f => {
            const saved = state.fields?.[f.id] || '';
            const placeholder = saved || f.placeholder || '';
            return `
                <label style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); flex: 1; min-width: 160px;">
                    ${this._escape(f.label)}
                    <input type="${f.secret ? 'password' : 'text'}" id="apikey-${p.id}-${f.id}"
                        placeholder="${this._escape(placeholder)}" autocomplete="off" ${busy ? 'disabled' : ''}
                        style="padding: 8px 10px; border: 1px solid var(--border, #d1d5db); border-radius: 4px; font-size: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
                </label>`;
        }).join('');
        return `
            <div class="card" style="margin-bottom: 12px;"><div class="card-body">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px;">
                    <div style="font-weight: 600;">${this._escape(p.name)}</div>
                    ${pill}
                </div>
                <div style="color: var(--text-secondary); font-size: 13px; line-height: 1.5; margin-bottom: 12px;">${p.help}</div>
                <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end;">
                    ${inputs}
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-primary btn-sm" ${busy ? 'disabled' : ''}
                            onclick="ApiKeysPage.save('${p.id}')">${busy ? 'Saving…' : 'Save'}</button>
                        ${state.set ? `<button class="btn btn-secondary btn-sm" ${busy ? 'disabled' : ''}
                            onclick="ApiKeysPage.remove('${p.id}')">Remove</button>` : ''}
                    </div>
                </div>
            </div></div>`;
    },

    async save(providerId) {
        const p = this.PROVIDERS.find(x => x.id === providerId);
        if (!p || this._busy) return;
        const value = {};
        let anyInput = false;
        for (const f of p.fields) {
            const el = document.getElementById(`apikey-${providerId}-${f.id}`);
            const v = (el?.value || '').trim();
            if (v) { value[f.id] = v; anyInput = true; }
        }
        if (!anyInput) {
            Toast.info('Enter a key first.');
            return;
        }
        // Multi-field providers must be saved whole — the store replaces the
        // provider entry, so a partial form would drop the missing fields.
        if (p.fields.length > 1 && p.fields.some(f => !value[f.id])) {
            Toast.error(`${p.name} needs all ${p.fields.length} fields.`);
            return;
        }
        await this._put(providerId, value, 'Key saved.');
    },

    async remove(providerId) {
        if (this._busy) return;
        const p = this.PROVIDERS.find(x => x.id === providerId);
        const confirmed = await ConfirmModal.confirm({
            title: `Remove ${p?.name || providerId} key?`,
            message: 'Dashie will stop using this key. You can add it again any time.',
            confirmLabel: 'Remove',
            cancelLabel: 'Cancel',
            danger: true,
        });
        if (!confirmed) return;
        await this._put(providerId, null, 'Key removed.');
    },

    async _put(providerId, value, successMsg) {
        this._busy = providerId;
        App.renderPage();
        try {
            const resp = await fetch(DashieAuth._addonUrl('/api/keys'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: providerId, value }),
            });
            if (resp.status === 401) throw new Error('Sign the add-on into a Dashie account first.');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this._providers = data?.providers || this._providers;
            Toast.success(successMsg);
        } catch (e) {
            console.error('[ApiKeysPage] save failed:', e);
            Toast.error(`Couldn't save: ${e?.message || e}`);
        }
        this._busy = null;
        App.renderPage();
    },

    _escape(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
};

window.ApiKeysPage = ApiKeysPage;
