/* ============================================================
   Voice & AI — Dashie Intelligence Analysis subpage
   ------------------------------------------------------------
   A transcript-forward view of recent voice interactions:

       [Save conversation details  (toggle)]   [Clear history]

       ── Recent interactions (newest first) ──
       ▸ 12:59 PM   COMPLEX · 1.4s · 12.7K tokens
            YOU SAID     what was the score…
            DASHIE SAID  Mexico beat South Korea 1–0.
            (subtext, if any)
            ── steps (expanded) ──
              PLAN/AI   gemini-2.5-flash · 1,060 in / 91 out · 0.3s
              SEARCH    tavily (9 results) · 0.8s
              AI        gemini-2.5-flash · 11,571 in / 86 out · 0.6s

   Source: get_intelligence_log (Supabase) + HA-local transcripts
   (add-on mode) merged by session_id. Toggle writes
   ai.retainTranscripts; Clear history nulls the stored text.
   Build plan §17.
   ============================================================ */

const VoiceAiAnalysis = {
    _loading: false,
    _loaded: false,
    _error: null,
    _interactions: [],
    _retain: false,
    _clearing: false,
    _expanded: new Set(),

    render() {
        if (!this._loaded && !this._loading && !this._error) {
            this.load();
            return this._wrap(this._renderLoading());
        }
        if (this._loading && !this._loaded) return this._wrap(this._renderLoading());
        if (this._error && !this._loaded) return this._wrap(this._renderError());
        return this._wrap(this._renderMain());
    },

    async load() {
        this._loading = true;
        this._error = null;
        try {
            const [log, defaults] = await Promise.all([
                DashieAuth.dbRequest('get_intelligence_log', { limit: 50, tz: this._tz() }),
                VoiceAiApi.loadAiDefaults().catch(() => ({})),
            ]);
            const interactions = log?.interactions || [];
            await this._mergeLocalTranscripts(interactions);
            this._interactions = interactions;
            this._retain = defaults['ai.retainTranscripts'] === true;
            this._loaded = true;
        } catch (e) {
            console.error('[VoiceAiAnalysis] load failed', e);
            this._error = e?.message || String(e);
        } finally {
            this._loading = false;
            App.renderPage();
        }
    },

    refresh() { this._loaded = false; this._interactions = []; this.load(); },

    // ── actions ──────────────────────────────────────────────

    async toggleRetain(enabled) {
        const prev = this._retain;
        this._retain = enabled;
        App.renderPage();
        try {
            await VoiceAiApi.saveAiDefault('ai.retainTranscripts', enabled);
            // Keep the Settings tab's copy in sync if it's loaded.
            if (typeof VoiceAiPage !== 'undefined' && VoiceAiPage._defaults) {
                VoiceAiPage._defaults['ai.retainTranscripts'] = enabled;
            }
        } catch (e) {
            this._retain = prev;
            Toast.error(`Couldn't update setting: ${e.message}`);
            App.renderPage();
        }
    },

    async clearHistory() {
        const ok = await ConfirmModal.confirm({
            title: 'Clear conversation history',
            message: 'This permanently deletes the saved text of your past interactions (what you said and the replies). Usage and credit history are unaffected.',
            confirmLabel: 'Clear',
            danger: true,
        });
        if (!ok) return;
        this._clearing = true;
        App.renderPage();
        try {
            await DashieAuth.dbRequest('clear_transcript_history', {});
            // HA kiosks keep transcripts locally — clear those too in add-on mode.
            if (typeof DashieAuth !== 'undefined' && DashieAuth.isAddonMode) {
                try { await fetch(DashieAuth._addonUrl('/api/transcripts'), { method: 'DELETE' }); } catch (e) { /* best-effort */ }
            }
            Toast.info('Conversation history cleared');
            this._clearing = false;
            this.refresh();
        } catch (e) {
            this._clearing = false;
            Toast.error(`Clear failed: ${e.message}`);
            App.renderPage();
        }
    },

    toggleInteraction(key) {
        if (this._expanded.has(key)) this._expanded.delete(key);
        else this._expanded.add(key);
        App.renderPage();
    },

    /** In add-on mode, overlay HA-local transcript text (kiosk turns keep words
     *  on the HA box, not Supabase) onto interactions by session_id. */
    async _mergeLocalTranscripts(interactions) {
        if (typeof DashieAuth === 'undefined' || !DashieAuth.isAddonMode || !interactions.length) return;
        if (interactions.every(i => i.prompt || i.response)) return;
        try {
            const data = await fetch(DashieAuth._addonUrl('/api/transcripts?limit=500'))
                .then(r => r.ok ? r.json() : null);
            const rows = data?.transcripts || [];
            if (!rows.length) return;
            const bySession = new Map();
            for (const t of rows) if (t.session_id) bySession.set(t.session_id, t);
            for (const intr of interactions) {
                if (intr.prompt || intr.response) continue;
                const t = intr.session_id && bySession.get(intr.session_id);
                if (t) { intr.prompt = t.text || null; intr.response = t.voice || null; intr.subtext = t.subtext || null; }
            }
        } catch (e) { /* best-effort */ }
    },

    // ── render ───────────────────────────────────────────────

    _wrap(inner) {
        return `<div style="max-width: 760px;">${this._renderHeader()}${inner}</div>`;
    },

    _renderHeader() {
        const on = this._retain;
        return `
            <div class="card" style="margin-bottom: 16px;"><div class="card-body">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 240px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">Save conversation details</div>
                        <div style="color: var(--text-secondary); font-size: 13px; line-height: 1.5;">
                            When on, Dashie keeps what you said and how it answered so you can review them here.
                            Cloud accounts store this securely; Home Assistant kiosks keep it on your own HA box.
                        </div>
                    </div>
                    <label class="toggle" style="flex-shrink: 0;">
                        <input type="checkbox" ${on ? 'checked' : ''} onchange="VoiceAiAnalysis.toggleRetain(this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
                <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
                    <button class="btn btn-secondary btn-sm" ${this._clearing ? 'disabled' : ''}
                        onclick="VoiceAiAnalysis.clearHistory()">
                        ${this._clearing ? 'Clearing…' : 'Clear history'}
                    </button>
                </div>
            </div></div>`;
    },

    _renderMain() {
        const items = this._interactions;
        if (!items.length) {
            return `
                <div class="card"><div class="card-body" style="color: var(--text-muted); text-align: center; padding: 32px 16px;">
                    ${this._retain
                        ? 'No saved interactions yet. Ask Dashie something and it’ll show up here.'
                        : 'Turn on “Save conversation details” above to start keeping a record of your interactions.'}
                </div></div>`;
        }
        return `
            <div class="card"><div class="card-body" style="padding: 0;">
                <div style="padding: 12px 16px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">
                    Recent interactions
                </div>
                ${items.map(i => this._renderInteraction(i)).join('')}
            </div></div>`;
    },

    _renderInteraction(intr) {
        const open = this._expanded.has(intr.key);
        const caret = open ? '▾' : '▸';
        const time = (() => {
            try { return new Date(intr.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
            catch { return intr.ts; }
        })();
        const badge = intr.complexity === 'complex'
            ? `<span style="background: var(--accent-soft, #eef2ff); color: var(--accent, #4f46e5); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; padding: 2px 6px; border-radius: 4px;">Complex</span>`
            : `<span style="background: var(--surface-muted, #f3f4f6); color: var(--text-muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; padding: 2px 6px; border-radius: 4px;">Simple</span>`;
        const meta = `${this._fmtMs(intr.total_latency_ms)} · ${this._fmtTokens(intr.total_tokens)} tokens`;

        const transcript = (intr.prompt || intr.response || intr.subtext) ? `
            <div style="background: var(--surface-muted, #f7f7f8); border-radius: 8px; padding: 10px 12px; margin: 0 0 8px;">
                ${intr.prompt ? this._line('You said', intr.prompt, 13) : ''}
                ${intr.response ? this._line('Dashie said', intr.response, 13) : ''}
                ${intr.subtext ? this._line('On-screen', intr.subtext, 12, true) : ''}
            </div>` : `<div style="color: var(--text-muted); font-size: 12px; margin: 0 0 8px;">(transcript not saved for this turn)</div>`;

        const steps = open ? `
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;"><tbody>
                ${intr.steps.map(s => this._renderStep(s)).join('')}
            </tbody></table>` : '';

        return `
            <div style="border-top: 1px solid var(--border, #f0f0f0);">
                <div onclick="VoiceAiAnalysis.toggleInteraction('${this._escape(intr.key)}')"
                    style="display: flex; align-items: center; gap: 10px; padding: 10px 16px; cursor: pointer;">
                    <span style="color: var(--text-muted); width: 12px; font-size: 11px;">${caret}</span>
                    <span style="color: var(--text-muted); width: 72px; font-size: 12px;">${this._escape(time)}</span>
                    <span style="flex-shrink: 0;">${badge}</span>
                    <span style="flex: 1; text-align: right; color: var(--text-muted); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${meta}</span>
                </div>
                <div style="padding: 0 16px 12px 38px;">
                    ${transcript}
                    ${steps}
                </div>
            </div>`;
    },

    _renderStep(s) {
        const desc = s.kind === 'ai'
            ? `${this._escape(s.label)} <span style="color: var(--text-muted);">(${this._fmtTokens(s.input_tokens)} in / ${this._fmtTokens(s.output_tokens)} out)</span>`
            : `${this._escape(s.label)} <span style="color: var(--text-muted);">(${this._fmtTokens(s.result_count || 0)} results)</span>`;
        const kind = s.kind === 'web_search' ? 'SEARCH' : 'AI';
        return `
            <tr>
                <td style="padding: 4px 0; color: var(--text-muted); width: 64px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px;">${kind}</td>
                <td style="padding: 4px 8px;">${desc}</td>
                <td style="padding: 4px 0; text-align: right; color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${this._fmtMs(s.latency_ms)}</td>
            </tr>`;
    },

    _line(label, val, size, muted) {
        return `
            <div style="margin: 0 0 4px;">
                <span style="color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">${label}</span>
                <div style="font-size: ${size}px; line-height: 1.4; ${muted ? 'color: var(--text-secondary);' : ''}">${this._escape(val)}</div>
            </div>`;
    },

    _renderLoading() {
        return `<div style="color: var(--text-muted); padding: 24px 4px;">Loading interactions…</div>`;
    },
    _renderError() {
        return `<div class="card"><div class="card-body" style="color: var(--status-error);">
            Failed to load: ${this._escape(this._error)}
            <div style="margin-top: 12px;"><button class="btn btn-secondary btn-sm" onclick="VoiceAiAnalysis.refresh()">Retry</button></div>
        </div></div>`;
    },

    // ── helpers ──────────────────────────────────────────────

    _tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } },
    _fmtMs(ms) {
        const n = Number(ms) || 0;
        return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)} ms`;
    },
    _fmtTokens(n) {
        const v = Number(n) || 0;
        if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
        return String(v);
    },
    _escape(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
};
