/* ============================================================
   Local Engines Page (add-on console only)
   ------------------------------------------------------------
   Manage the "own box" engines the user runs themselves — AI models (Ollama /
   llama.cpp), text-to-speech (Kokoro / Piper) and speech-to-text (whisper.cpp /
   faster-whisper). Each saved engine is a NAMED PRESET (see EnginesStore); they
   appear by name in the Voice & AI pickers, so switching between "Qwen 7B on the
   Mac" and "Kokoro" is one click instead of re-typing an IP.

   Storage: EnginesStore (JSON array in user_settings). Selecting an engine over
   in Voice & AI resolves it into the flat keys the tablets already read — the
   device never learns this registry exists.

   PROBE-ON-ENTRY: leaving (or pressing Enter in) the URL field probes the box
   through the add-on — the browser can't reach a LAN http:// engine from an
   https:// page — and the answer populates the Voice/Model dropdown. That's why
   this page is add-on-gated (FeatureGate 'localEngines' → 'addon').

   No secrets live here: an endpoint needing a key uses the API Keys page.
   ============================================================ */

const LocalEnginesPage = {
    _engines: null,       // [] once loaded
    _loading: false,
    _error: null,
    _editing: null,       // the engine draft being added/edited: {id?, name, kind, url, model}
    _probe: null,         // { state: 'idle'|'probing'|'ok'|'fail', detail, options[] } for the draft URL
    _busy: false,         // save/delete in flight

    topBarTitle() { return 'Local Engines'; },
    topBarSubtitle() { return ''; },

    onNavigateTo() { this._fetch(); },
    async refresh() { await this._fetch(); },

    async _fetch() {
        this._loading = true;
        this._error = null;
        App.renderPage();
        try {
            this._engines = await EnginesStore.list();
        } catch (e) {
            console.error('[LocalEnginesPage] fetch failed:', e);
            this._error = e?.message || String(e);
        }
        this._loading = false;
        App.renderPage();
    },

    // ── editing ──────────────────────────────────────────────

    add(kind = 'llm') {
        this._editing = { id: null, name: '', kind, url: '', model: '' };
        this._probe = null;
        App.renderPage();
    },

    edit(id) {
        const e = (this._engines || []).find(x => x.id === id);
        if (!e) return;
        this._editing = { ...e };
        this._probe = null;
        App.renderPage();
        // Re-probe the saved URL so the Voice/Model dropdown is populated on open.
        if (e.url) this.probeDraft();
    },

    cancelEdit() {
        this._editing = null;
        this._probe = null;
        App.renderPage();
    },

    /** Field edits keep the draft in memory (no re-render — that would blur the input
     *  mid-type). The URL field re-renders only via probeDraft on Enter/blur. */
    setField(field, value) {
        if (!this._editing) return;
        this._editing[field] = value;
    },

    /** Probe-on-entry: ask the box what it offers, and turn Voice/Model into a
     *  dropdown. Fired on blur/Enter of the URL field. */
    async probeDraft() {
        const d = this._editing;
        if (!d) return;
        const url = String(d.url || '').trim();
        if (!url) { this._probe = null; App.renderPage(); return; }
        if (!/^https?:\/\//i.test(url)) {
            this._probe = { state: 'fail', detail: 'enter a full http:// URL (with port)', options: [] };
            App.renderPage();
            return;
        }
        const kind = EnginesStore.kind(d.kind);
        this._probe = { state: 'probing', detail: '', options: [] };
        App.renderPage();
        let result = null;
        try {
            const r = await fetch(DashieAuth._addonUrl('/api/voice/probe'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, kind: kind?.probe || 'llm' }),
            });
            result = r.ok ? await r.json() : { ok: false, detail: `HTTP ${r.status}` };
        } catch (e) {
            result = { ok: false, detail: e?.message || String(e) };
        }
        // Guard: the user may have switched drafts while the probe was in flight.
        if (this._editing !== d) return;
        this._probe = {
            state: result?.ok ? 'ok' : 'fail',
            detail: result?.detail || (result?.ok ? 'reachable' : 'no response'),
            options: result?.options || [],
        };
        // Blank model + a known list → preselect the first (AI engines only; a TTS engine
        // has no model/voice of its own — the voice is chosen on the Voice & AI card).
        if (result?.ok && d.kind === 'llm' && !String(d.model || '').trim() && this._probe.options.length) {
            d.model = this._probe.options[0].value;
        }
        App.renderPage();
    },

    async saveDraft() {
        const d = this._editing;
        if (!d || this._busy) return;
        if (!String(d.name || '').trim()) { Toast.error('Give the engine a name.'); return; }
        if (!/^https?:\/\//i.test(String(d.url || '').trim())) { Toast.error('Enter a full http:// URL (with port).'); return; }
        this._busy = true;
        App.renderPage();
        try {
            const saved = await EnginesStore.save(d);
            this._engines = await EnginesStore.list();
            // If this engine is the one currently in use, rewrite the resolved keys —
            // otherwise a changed URL/voice would never reach the tablets.
            await this._reResolveIfSelected(saved);
            this._editing = null;
            this._probe = null;
            Toast.success(`Saved “${saved.name}”.`);
        } catch (e) {
            console.error('[LocalEnginesPage] save failed:', e);
            Toast.error(`Couldn't save: ${e?.message || e}`);
        }
        this._busy = false;
        App.renderPage();
    },

    /** An edit to the ACTIVE engine must re-push its resolved values (the tablets read
     *  voice.localTtsUrl etc., not the engine record). */
    async _reResolveIfSelected(engine) {
        let defaults = null;
        try { defaults = await VoiceAiApi.loadAiDefaults(); } catch { return; }
        const active = EnginesStore.matchSelected(engine.kind, defaults);
        if (!active || active.id !== engine.id) return;
        for (const [key, value] of EnginesStore.resolveToSettings(engine)) {
            await DashieAuth.patchUserSetting(key, value);
        }
    },

    async duplicate(id) {
        try {
            await EnginesStore.duplicate(id);
            this._engines = await EnginesStore.list();
            App.renderPage();
        } catch (e) { Toast.error(`Couldn't duplicate: ${e?.message || e}`); }
    },

    async remove(id) {
        const e = (this._engines || []).find(x => x.id === id);
        const ok = await ConfirmModal.confirm({
            title: 'Remove engine',
            message: `“${e?.name || 'This engine'}” will be removed from your saved engines. Any device currently using it keeps working until you pick something else.`,
            confirmLabel: 'Remove',
            danger: true,
        });
        if (!ok) return;
        try {
            await EnginesStore.remove(id);
            this._engines = await EnginesStore.list();
            App.renderPage();
        } catch (err) { Toast.error(`Couldn't remove: ${err?.message || err}`); }
    },

    // ── render ───────────────────────────────────────────────

    render() {
        if (typeof DashieAuth === 'undefined' || !DashieAuth.isAddonMode) {
            return `
                <div class="card" style="max-width: 800px;"><div class="card-body" style="color: var(--text-secondary);">
                    Local engines run on your own network, so they're managed from the Dashie Console
                    add-on on your Home Assistant box.
                </div></div>`;
        }
        if (!this._engines && !this._loading && !this._error) {
            this._fetch();
            return `<div style="max-width: 800px; color: var(--text-muted); padding: 20px 0;">Loading…</div>`;
        }
        if (this._loading && !this._engines) {
            return `<div style="max-width: 800px; color: var(--text-muted); padding: 20px 0;">Loading…</div>`;
        }
        if (this._error && !this._engines) {
            return `
                <div class="card" style="max-width: 800px;"><div class="card-body" style="color: var(--status-error, #c00);">
                    Couldn't load engines: ${this._escape(this._error)}
                    <button class="btn btn-secondary btn-sm" style="margin-left: 12px;" onclick="LocalEnginesPage._fetch()">Retry</button>
                </div></div>`;
        }
        return `
            <div style="max-width: 800px;">
                <div style="margin-bottom: 20px; color: var(--text-secondary); font-size: var(--font-size-sm); line-height: 1.5;">
                    Engines you run yourself — an AI model, a voice, or speech-to-text on your own
                    hardware. Saved engines appear by name in <strong>Voice &amp; AI</strong>, so you
                    can switch between them without re-typing an address. They're free to run and
                    nothing leaves your network.
                </div>
                ${this._editing ? this._renderEditor() : ''}
                ${EnginesStore.KINDS.map(k => this._renderKindSection(k)).join('')}
            </div>`;
    },

    _renderKindSection(kind) {
        const list = (this._engines || []).filter(e => e.kind === kind.id);
        const rows = list.length
            ? list.map(e => this._renderEngineRow(e)).join('')
            : `<div class="card"><div class="card-body" style="color: var(--text-muted); font-size: 13px;">
                   None yet — ${this._escape(kind.hint)}.
               </div></div>`;
        return `
            <div class="section-header" style="margin-top: 24px; display: flex; justify-content: space-between; align-items: center;">
                <span>${this._escape(kind.label)}</span>
                <button class="btn btn-secondary btn-sm" onclick="LocalEnginesPage.add('${kind.id}')"${this._editing ? ' disabled' : ''}>+ Add</button>
            </div>
            ${rows}`;
    },

    _renderEngineRow(e) {
        const sub = [e.url, e.model].filter(Boolean).join(' · ');
        return `
            <div class="card" style="margin-bottom: 8px;"><div class="card-body" style="display: flex; align-items: center; gap: 12px; padding: 12px 14px;">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 600; font-size: 14px;">${this._escape(e.name)}</div>
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis;">${this._escape(sub)}</div>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="LocalEnginesPage.edit('${e.id}')">Edit</button>
                <button class="btn btn-secondary btn-sm" onclick="LocalEnginesPage.duplicate('${e.id}')" title="Add another model/voice on this same box">Duplicate</button>
                <button class="btn btn-secondary btn-sm" onclick="LocalEnginesPage.remove('${e.id}')">Remove</button>
            </div></div>`;
    },

    _renderEditor() {
        const d = this._editing;
        const kind = EnginesStore.kind(d.kind) || EnginesStore.KINDS[0];
        const p = this._probe;
        const status = !p ? ''
            : p.state === 'probing' ? `<span style="color: var(--text-muted);">checking…</span>`
            : p.state === 'ok' ? `<span style="color: var(--status-success, #16a34a);">✓ ${this._escape(p.detail)}</span>`
            : `<span style="color: var(--status-error, #c00);">✗ ${this._escape(p.detail)}</span>
               <a href="#" onclick="event.preventDefault(); LocalEnginesPage.probeDraft()" style="margin-left: 8px; font-size: 12px;">Re-check</a>`;

        // Model field: AI engines only (kind.modelLabel present). A TTS engine is just a
        // box — its VOICE is picked on the Voice & AI card, so offering a voice here too
        // would be a second source of truth. STT servers expose no model list.
        const opts = p?.options || [];
        const modelRow = !kind.modelLabel ? '' : `
                    <label style="display: grid; gap: 4px; font-size: 12px; color: var(--text-muted);">
                        ${this._escape(kind.modelLabel)}
                        ${opts.length
                            ? `<select onchange="LocalEnginesPage.setField('model', this.value)" style="${this._inputStyle()}">
                                   ${opts.map(o => `<option value="${this._escape(o.value)}" ${o.value === d.model ? 'selected' : ''}>${this._escape(o.label)}</option>`).join('')}
                                   ${d.model && !opts.some(o => o.value === d.model) ? `<option value="${this._escape(d.model)}" selected>${this._escape(d.model)} (current)</option>` : ''}
                               </select>`
                            : `<input type="text" value="${this._escape(d.model || '')}" placeholder="${this._escape(kind.modelPlaceholder || '')}"
                                   autocomplete="off" oninput="LocalEnginesPage.setField('model', this.value)" style="${this._inputStyle()}">`}
                    </label>`;
        const voiceNote = d.kind === 'tts'
            ? `<div style="font-size: 12px; color: var(--text-muted); line-height: 1.5;">
                   Pick the voice under <strong>Voice &amp; AI</strong> once this engine is selected — its
                   voices are read from the box itself.
               </div>`
            : '';

        return `
            <div class="card" style="margin-bottom: 20px; box-shadow: 0 0 0 2px var(--accent);"><div class="card-body">
                <div style="font-weight: 600; margin-bottom: 14px;">${d.id ? 'Edit engine' : `New ${this._escape(kind.label.toLowerCase())}`}</div>
                <div style="display: grid; gap: 12px;">
                    <label style="display: grid; gap: 4px; font-size: 12px; color: var(--text-muted);">
                        Name
                        <input type="text" value="${this._escape(d.name || '')}" placeholder="e.g. Qwen 7B on the Mac"
                            autocomplete="off" oninput="LocalEnginesPage.setField('name', this.value)" style="${this._inputStyle()}">
                    </label>
                    <label style="display: grid; gap: 4px; font-size: 12px; color: var(--text-muted);">
                        Address
                        <input type="text" id="engine-url" value="${this._escape(d.url || '')}" placeholder="${this._escape(kind.urlPlaceholder)}"
                            autocomplete="off" spellcheck="false"
                            oninput="LocalEnginesPage.setField('url', this.value)"
                            onblur="LocalEnginesPage.probeDraft()"
                            onkeydown="if (event.key === 'Enter') { event.preventDefault(); this.blur(); }"
                            style="${this._inputStyle()}">
                        <span style="min-height: 16px; font-size: 12px;">${status}</span>
                    </label>
                    ${modelRow}
                    ${voiceNote}
                </div>
                <div style="display: flex; gap: 8px; margin-top: 16px;">
                    <button class="btn btn-primary btn-sm" onclick="LocalEnginesPage.saveDraft()"${this._busy ? ' disabled' : ''}>${this._busy ? 'Saving…' : 'Save'}</button>
                    <button class="btn btn-secondary btn-sm" onclick="LocalEnginesPage.cancelEdit()">Cancel</button>
                </div>
            </div></div>`;
    },

    _inputStyle() {
        return 'padding: 8px 10px; border: 1px solid var(--border, #d1d5db); border-radius: 5px; font-size: 13px; width: 100%; box-sizing: border-box;';
    },

    _escape(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
};

window.LocalEnginesPage = LocalEnginesPage;
