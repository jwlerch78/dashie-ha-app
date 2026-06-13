/* ============================================================
   Account → Token Usage tab
   ------------------------------------------------------------
   Phase 1 of the credits/billing build (see Phase G in
   /Users/johnlerch/projects/dashieapp_staging/.reference/build-plans/
   20260415_DASHIE_HA_ADDON_W_TOKEN_MGMT.md).

   What this view does today:
     - Stat strip: current balance, today's spend, this-month's spend
     - Range selector: Today / 7d / 30d / This month / Custom
     - "By service" table: aggregate across the selected range, grouped
       by service type (AI / TTS / STT / Web search) and itemised by
       provider+model. Costs computed client-side from window.AiModelCatalog
       (the bundle shared with the web + Android apps).
     - "Daily breakdown" rows: per-day totals with inline expand on click
       (per-call list with timestamp + model + cost).
     - Admin-only "Add credits" form (gated on is_admin flag returned by
       get_credit_balance).

   What it does NOT do yet (Phase 3+):
     - No deduction. Costs shown are pure spend estimates from log rows;
       the balance is a static number granted via admin tool.
     - Includes/purchased tranches, expiry, BYOK — all deferred.

   All reads go through DashieAuth.dbRequest('get_credit_balance' /
   'get_usage_summary' / 'get_usage_daily' / 'get_usage_calls').
   ============================================================ */

const AccountUsage = {
    _balance: null,            // {balance, lifetime_granted, is_admin}
    _summary: null,            // {range_start, range_end, by_service: [...]}
    _daily: null,              // {days: [{date, by_service: [...]}]}
    _activeRange: '30d',       // 'today' | '7d' | '30d' | 'month' | 'custom'
    _customStart: null,
    _customEnd: null,
    _loading: false,
    _error: null,

    /** Inline-expanded daily rows: Map<dateString, {loading, calls?, error?}> */
    _expandedDays: new Map(),

    /** Admin form state. */
    _adminForm: { open: false, email: '', amount: '', note: '', busy: false, error: null },

    // ── lifecycle ─────────────────────────────────────────────

    onNavigateTo() { this._fetchAll(); },

    async _fetchAll() {
        this._loading = true;
        this._error = null;
        App.renderPage();
        try {
            const { start, end } = this._rangeBounds();
            const [bal, sum, daily] = await Promise.all([
                DashieAuth.dbRequest('get_credit_balance', {}),
                DashieAuth.dbRequest('get_usage_summary', { range_start: start, range_end: end }),
                DashieAuth.dbRequest('get_usage_daily',   { range_start: start, range_end: end }),
            ]);
            this._balance = bal;
            this._summary = sum;
            this._daily = daily;
            this._loading = false;
            App.renderPage();
        } catch (e) {
            console.error('[AccountUsage] fetch failed', e);
            this._error = e?.message || String(e);
            this._loading = false;
            App.renderPage();
        }
    },

    setRange(range) {
        if (range === this._activeRange) return;
        this._activeRange = range;
        if (range !== 'custom') {
            this._expandedDays.clear();
            this._fetchAll();
        } else {
            App.renderPage();
        }
    },

    applyCustomRange(start, end) {
        this._customStart = start;
        this._customEnd = end;
        this._activeRange = 'custom';
        this._expandedDays.clear();
        this._fetchAll();
    },

    /** Compute start + end ISO strings for the active range. */
    _rangeBounds() {
        const now = new Date();
        const endIso = now.toISOString();
        let start;
        switch (this._activeRange) {
            case 'today': {
                const s = new Date(now); s.setUTCHours(0, 0, 0, 0); start = s.toISOString(); break;
            }
            case '7d':    start = new Date(now.getTime() - 7 * 86400_000).toISOString(); break;
            case 'month': {
                const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
                start = s.toISOString(); break;
            }
            case 'custom':
                start = this._customStart || new Date(now.getTime() - 30 * 86400_000).toISOString();
                return { start, end: this._customEnd || endIso };
            case '30d':
            default:
                start = new Date(now.getTime() - 30 * 86400_000).toISOString();
        }
        return { start, end: endIso };
    },

    // ── cost helpers ──────────────────────────────────────────

    /** USD cost for a summary row, derived from token counts / call counts
     *  + the bundled TOKEN_COSTS catalog. Returns 0 when pricing unknown. */
    _costForRow(row) {
        const C = window.AiModelCatalog;
        if (!C || !row) return 0;
        if (row.service === 'ai') {
            const rates = row.model ? C.pricingFor(row.model) : null;
            if (!rates) return 0;
            return ((row.input_tokens || 0) * rates[0] + (row.output_tokens || 0) * rates[1]) / 1_000_000;
        }
        if (row.service === 'web_search') {
            return C.searchCost({ provider: row.provider, count: row.call_count || 0 });
        }
        if (row.service === 'stt') {
            return C.sttCost({ provider: row.provider, seconds: row.total_seconds || 0 });
        }
        if (row.service === 'tts') {
            return C.ttsCost({ provider: row.provider, characters: row.total_chars || 0 });
        }
        return 0;
    },

    _fmtCost(amount) {
        if (amount == null || !isFinite(amount) || amount === 0) return '$0.00';
        if (amount < 0.01) return '$' + amount.toFixed(4);
        return '$' + amount.toFixed(2);
    },

    _fmtCount(n) {
        if (n == null) return '—';
        return n.toLocaleString();
    },

    _fmtDate(d) {
        try {
            const [y, m, day] = d.split('-').map(Number);
            const dt = new Date(Date.UTC(y, m - 1, day));
            return dt.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
        } catch { return d; }
    },

    /** "ai" → "AI Models", etc. */
    _serviceLabel(svc) {
        return { ai: 'AI Models', tts: 'Speech (TTS)', stt: 'Speech (STT)', web_search: 'Web Search' }[svc] || svc;
    },

    // ── admin form ────────────────────────────────────────────

    openAdminForm()  { this._adminForm.open = true; App.renderPage(); },
    closeAdminForm() { this._adminForm = { open: false, email: '', amount: '', note: '', busy: false, error: null }; App.renderPage(); },
    setAdminField(field, value) { this._adminForm[field] = value; },

    async submitAdminForm() {
        const f = this._adminForm;
        if (f.busy) return;
        const amount = Number(f.amount);
        if (!f.email || !isFinite(amount) || amount <= 0) {
            f.error = 'Email and a positive amount are required.';
            App.renderPage();
            return;
        }
        f.busy = true; f.error = null;
        App.renderPage();
        try {
            const result = await DashieAuth.dbRequest('admin_add_credits', {
                target_email: f.email.trim(),
                amount,
                note: f.note?.trim() || null,
            });
            Toast.success(`Granted ${this._fmtCost(amount)} to ${result.target_email}. New balance: ${this._fmtCost(result.new_balance)}.`);
            this.closeAdminForm();
            this._fetchAll();  // refresh own balance if granted to self
        } catch (e) {
            f.error = e?.message || String(e);
            f.busy = false;
            App.renderPage();
        }
    },

    // ── daily-row expansion ───────────────────────────────────

    async toggleDay(date) {
        const cur = this._expandedDays.get(date);
        if (cur) {
            this._expandedDays.delete(date);
            App.renderPage();
            return;
        }
        this._expandedDays.set(date, { loading: true });
        App.renderPage();
        try {
            const result = await DashieAuth.dbRequest('get_usage_calls', { date });
            this._expandedDays.set(date, { loading: false, calls: result.calls || [] });
        } catch (e) {
            this._expandedDays.set(date, { loading: false, error: e?.message || String(e) });
        }
        App.renderPage();
    },

    // ── render ────────────────────────────────────────────────

    render() {
        if (this._error) {
            return `
                <div style="max-width: 800px;">
                    <div class="card"><div class="card-body" style="color: var(--status-error, #c00);">
                        Couldn't load usage data: ${this._escape(this._error)}
                        <button class="btn btn-secondary btn-sm" style="margin-left: 12px;" onclick="AccountUsage._fetchAll()">Retry</button>
                    </div></div>
                </div>`;
        }

        if (this._loading && !this._balance) {
            return `<div style="max-width: 800px; color: var(--text-muted); padding: 20px 0;">Loading usage…</div>`;
        }

        return `
            <div style="max-width: 800px;">
                ${this._renderStatStrip()}
                ${this._renderAdminSection()}
                ${this._renderRangeBar()}
                ${this._renderSummaryCard()}
                ${this._renderDailyCard()}
            </div>`;
    },

    _renderStatStrip() {
        const bal = this._balance || {};
        // Today + month totals are derived from the existing summary fetch
        // when the active range covers them; otherwise we show a "—".
        const todayCost = this._totalCostForDay(this._todayDate());
        const monthCost = this._totalCostForMonth();
        return `
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
                ${this._statCard('Balance', this._fmtCost(bal.balance || 0),
                    bal.lifetime_granted ? `${this._fmtCost(bal.lifetime_granted)} granted total` : '')}
                ${this._statCard('Today', todayCost == null ? '—' : this._fmtCost(todayCost), '')}
                ${this._statCard('This month', monthCost == null ? '—' : this._fmtCost(monthCost), '')}
            </div>`;
    },

    _statCard(label, value, sub) {
        return `
            <div class="card"><div class="card-body" style="padding: 14px 16px;">
                <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">${this._escape(label)}</div>
                <div style="font-size: 22px; font-weight: 700; color: var(--text-primary); margin-top: 4px;">${this._escape(value)}</div>
                ${sub ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${this._escape(sub)}</div>` : ''}
            </div></div>`;
    },

    _renderAdminSection() {
        if (!this._balance?.is_admin) return '';
        const f = this._adminForm;
        if (!f.open) {
            return `
                <div style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--bg-muted, #f4f4f5); border-radius: 6px; margin-bottom: 16px; font-size: 13px;">
                    <span style="font-weight: 600;">⚙ Admin tools</span>
                    <button class="btn btn-secondary btn-sm" onclick="AccountUsage.openAdminForm()">Add credits…</button>
                </div>`;
        }
        return `
            <div class="card" style="margin-bottom: 16px; border-left: 3px solid var(--accent);">
                <div class="card-body">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                        <strong>Add credits</strong>
                        <button class="btn btn-ghost btn-sm" onclick="AccountUsage.closeAdminForm()">Cancel</button>
                    </div>
                    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 8px;">
                        <label style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted);">
                            User email
                            <input type="email" value="${this._escape(f.email)}" placeholder="floridalerches@gmail.com"
                                oninput="AccountUsage.setAdminField('email', this.value)"
                                ${f.busy ? 'disabled' : ''}
                                style="padding: 8px 10px; border: 1px solid var(--border, #d1d5db); border-radius: 4px; font-size: 14px;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted);">
                            Amount (USD)
                            <input type="number" min="0.01" max="1000" step="0.01" value="${this._escape(f.amount)}"
                                oninput="AccountUsage.setAdminField('amount', this.value)"
                                ${f.busy ? 'disabled' : ''}
                                style="padding: 8px 10px; border: 1px solid var(--border, #d1d5db); border-radius: 4px; font-size: 14px;">
                        </label>
                    </div>
                    <label style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
                        Note (optional)
                        <input type="text" value="${this._escape(f.note)}" placeholder="Testing credit flow"
                            oninput="AccountUsage.setAdminField('note', this.value)"
                            ${f.busy ? 'disabled' : ''}
                            style="padding: 8px 10px; border: 1px solid var(--border, #d1d5db); border-radius: 4px; font-size: 14px;">
                    </label>
                    ${f.error ? `<div style="color: var(--status-error, #c00); font-size: 13px; margin-bottom: 8px;">${this._escape(f.error)}</div>` : ''}
                    <button class="btn btn-primary btn-sm" ${f.busy ? 'disabled' : ''}
                        onclick="AccountUsage.submitAdminForm()">
                        ${f.busy ? 'Granting…' : 'Grant credits'}
                    </button>
                </div>
            </div>`;
    },

    _renderRangeBar() {
        const ranges = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month']];
        return `
            <div style="display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap;">
                ${ranges.map(([id, label]) => `
                    <button class="btn ${this._activeRange === id ? 'btn-primary' : 'btn-secondary'} btn-sm"
                        onclick="AccountUsage.setRange('${id}')">${label}</button>`).join('')}
            </div>`;
    },

    _renderSummaryCard() {
        const rows = this._summary?.by_service || [];
        if (rows.length === 0) {
            return `
                <div class="card" style="margin-bottom: 20px;"><div class="card-body" style="color: var(--text-muted); text-align: center; padding: 32px 16px;">
                    No usage recorded in this range yet.
                </div></div>`;
        }

        // Group by service for clean section headers in the table.
        const groups = new Map();
        for (const r of rows) {
            const g = groups.get(r.service) || [];
            g.push(r);
            groups.set(r.service, g);
        }
        const order = ['ai', 'tts', 'stt', 'web_search'];
        const sections = order.filter(s => groups.has(s)).map(svc => {
            const items = groups.get(svc);
            const total = items.reduce((sum, r) => sum + this._costForRow(r), 0);
            const itemRows = items.map(r => this._summaryItemRow(r)).join('');
            return `
                <tr><td colspan="4" style="padding: 14px 12px 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">
                    ${this._escape(this._serviceLabel(svc))}
                    <span style="float: right; color: var(--text-primary); font-weight: 600;">${this._fmtCost(total)}</span>
                </td></tr>
                ${itemRows}`;
        }).join('');

        const grand = rows.reduce((sum, r) => sum + this._costForRow(r), 0);
        return `
            <div class="card" style="margin-bottom: 20px;"><div class="card-body" style="padding: 0;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tbody>${sections}</tbody>
                    <tfoot>
                        <tr style="border-top: 1px solid var(--border, #e5e7eb);">
                            <td style="padding: 12px; font-weight: 600;">Total</td>
                            <td colspan="2"></td>
                            <td style="padding: 12px; text-align: right; font-weight: 700;">${this._fmtCost(grand)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div></div>`;
    },

    _summaryItemRow(r) {
        const cost = this._costForRow(r);
        const subtitle = r.service === 'ai'
            ? `${this._fmtCount(r.input_tokens)} in / ${this._fmtCount(r.output_tokens)} out`
            : r.service === 'web_search'
                ? `${this._fmtCount(r.call_count)} searches`
                : `${this._fmtCount(r.call_count)} calls`;
        return `
            <tr style="border-top: 1px solid var(--border, #e5e7eb);">
                <td style="padding: 8px 12px; font-size: 13px; width: 35%;">${this._escape(r.model || r.provider || '—')}</td>
                <td style="padding: 8px 12px; font-size: 12px; color: var(--text-muted);">${this._escape(r.provider || '')}</td>
                <td style="padding: 8px 12px; font-size: 12px; color: var(--text-muted); text-align: right;">${this._fmtCount(r.call_count)} · ${this._escape(subtitle)}</td>
                <td style="padding: 8px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; text-align: right;">${this._fmtCost(cost)}</td>
            </tr>`;
    },

    _renderDailyCard() {
        const days = this._daily?.days || [];
        if (days.length === 0) return '';
        return `
            <div class="card"><div class="card-body" style="padding: 0;">
                <div style="padding: 12px 16px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); border-bottom: 1px solid var(--border, #e5e7eb);">
                    Daily breakdown
                </div>
                ${days.map(d => this._renderDayRow(d)).join('')}
            </div></div>`;
    },

    _renderDayRow(d) {
        const expanded = this._expandedDays.get(d.date);
        const total = (d.by_service || []).reduce((sum, r) => sum + this._costForRow(r), 0);
        const sparkline = this._dayServicePills(d.by_service || []);
        const caret = expanded ? '▾' : '▸';

        let detail = '';
        if (expanded) {
            if (expanded.loading) {
                detail = `<div style="padding: 12px 32px; color: var(--text-muted); font-size: 13px;">Loading calls…</div>`;
            } else if (expanded.error) {
                detail = `<div style="padding: 12px 32px; color: var(--status-error, #c00); font-size: 13px;">Error: ${this._escape(expanded.error)}</div>`;
            } else {
                const calls = expanded.calls || [];
                if (calls.length === 0) {
                    detail = `<div style="padding: 12px 32px; color: var(--text-muted); font-size: 13px;">No calls recorded.</div>`;
                } else {
                    detail = `
                        <div style="padding: 4px 32px 12px;">
                            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                                <tbody>
                                    ${calls.map(c => this._renderCallRow(c)).join('')}
                                </tbody>
                            </table>
                        </div>`;
                }
            }
        }

        return `
            <div style="border-bottom: 1px solid var(--border, #e5e7eb);">
                <div onclick="AccountUsage.toggleDay('${d.date}')"
                    style="display: flex; align-items: center; gap: 12px; padding: 10px 16px; cursor: pointer;">
                    <span style="color: var(--text-muted); width: 12px;">${caret}</span>
                    <span style="font-size: 13px; font-weight: 500; min-width: 110px;">${this._escape(this._fmtDate(d.date))}</span>
                    <span style="flex: 1; font-size: 12px; color: var(--text-muted);">${sparkline}</span>
                    <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; font-weight: 600;">${this._fmtCost(total)}</span>
                </div>
                ${detail}
            </div>`;
    },

    _dayServicePills(rows) {
        const byService = new Map();
        for (const r of rows) {
            const cost = this._costForRow(r);
            byService.set(r.service, (byService.get(r.service) || 0) + cost);
        }
        const labels = { ai: 'AI', tts: 'TTS', stt: 'STT', web_search: 'Search' };
        return Array.from(byService.entries())
            .filter(([_, c]) => c > 0)
            .map(([svc, c]) => `${labels[svc] || svc} ${this._fmtCost(c)}`)
            .join(' · ');
    },

    _renderCallRow(c) {
        const cost = this._costForRow({
            service: c.service,
            provider: c.provider,
            model: c.model,
            input_tokens: c.input_tokens,
            output_tokens: c.output_tokens,
            call_count: c.service === 'web_search' ? 1 : 0,
            total_seconds: c.duration_seconds || 0,
            total_chars: c.char_count || 0,
        });
        const time = (() => {
            try { return new Date(c.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
            catch { return c.ts; }
        })();
        const desc = c.service === 'ai'
            ? `${this._escape(c.model || '—')} (${this._fmtCount(c.input_tokens)} in / ${this._fmtCount(c.output_tokens)} out)`
            : c.service === 'web_search'
                ? `${this._escape(c.provider || '')} (${this._fmtCount(c.result_count || 0)} results)`
                : `${this._escape(c.provider || '')} ${c.service}`;
        return `
            <tr>
                <td style="padding: 4px 0; color: var(--text-muted); width: 80px;">${this._escape(time)}</td>
                <td style="padding: 4px 0; color: var(--text-muted); width: 60px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px;">${this._escape(c.service)}</td>
                <td style="padding: 4px 8px;">${desc}</td>
                <td style="padding: 4px 0; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${this._fmtCost(cost)}</td>
            </tr>`;
    },

    // ── helpers used by stat strip ───────────────────────────

    _todayDate() {
        const now = new Date();
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    },

    _totalCostForDay(dateStr) {
        if (!this._daily?.days) return null;
        const row = this._daily.days.find(d => d.date === dateStr);
        if (!row) return 0;
        return (row.by_service || []).reduce((sum, r) => sum + this._costForRow(r), 0);
    },

    _totalCostForMonth() {
        if (!this._daily?.days) return null;
        const now = new Date();
        const prefix = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-`;
        return this._daily.days
            .filter(d => d.date.startsWith(prefix))
            .reduce((sum, d) => sum + (d.by_service || []).reduce((s, r) => s + this._costForRow(r), 0), 0);
    },

    _escape(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
};

window.AccountUsage = AccountUsage;
