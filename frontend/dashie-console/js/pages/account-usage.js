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
    _daily: null,              // {days: [...]} for the SELECTED range (breakdown card)
    _monthDaily: null,         // {days: [...]} always current month — powers the range-independent stat cards
    _rates: null,              // {rates: [...]} margined customer rate card for the pricing table
    _expiry: null,             // {next_expiry:{amount,expires_at}, lots:[...]} — get_credit_expiry
    _flash: null,              // transient banner (e.g. after returning from Stripe)
    _activeRange: '30d',       // 'today' | '7d' | '30d' | 'month' | 'custom'
    _customStart: null,
    _customEnd: null,
    _loading: false,
    _error: null,

    /** Inline-expanded daily rows: Map<dateString, {loading, interactions?, error?}> */
    _expandedDays: new Map(),
    /** Inline-expanded voice-interaction rows, by interaction key. */
    _expandedInteractions: new Set(),
    /** Expanded service groups in the summary card (collapsed by default). */
    _expandedServices: new Set(),

    /** Breakdown card: view mode + (year-list) expanded month groups. */
    _breakdownView: 'list',       // 'list' | 'daily' | 'monthly'
    _expandedMonths: new Set(),
    DAILY_GRAPH_CAP: 90,          // Daily Graph caps at the most recent N days (year range)

    /** Admin form state. */
    _adminForm: { open: false, email: '', amount: '', note: '', busy: false, error: null },

    // ── lifecycle ─────────────────────────────────────────────

    onNavigateTo() { this._checkReturn(); this._fetchAll(); },

    /** After returning from Stripe Checkout (?credits=success), show a banner and
     *  strip the param. The grant lands via webhook (async), so the balance may
     *  take a moment — _fetchAll re-reads it. */
    _checkReturn() {
        try {
            const params = new URLSearchParams(window.location.search);
            const c = params.get('credits');
            if (c === 'success') this._flash = 'Payment received — your credits will appear in a moment.';
            else if (c === 'cancel') this._flash = 'Checkout canceled — no charge.';
            if (c) {
                params.delete('credits');
                const clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
                window.history.replaceState({}, '', clean);
            }
        } catch { /* ignore */ }
    },

    async _fetchAll() {
        this._loading = true;
        this._error = null;
        App.renderPage();
        try {
            const { start, end } = this._rangeBounds();
            const tz = this._tz();
            // Stat cards (Today / This month) must be range-INDEPENDENT, so fetch
            // the current month's daily separately from the selected-range data.
            const now = new Date();
            // Range-INDEPENDENT stat window: cover both "this week" and "this month".
            // Early in a month the calendar week reaches into the prior month, so start
            // at whichever is earlier (else "This week" undercounts across the boundary).
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const weekStart = this._weekStart();
            const statStart = (weekStart < monthStart ? weekStart : monthStart).toISOString();
            const nowIso = now.toISOString();
            // Auto-replenish state lives in CreditsControls now (shared with the
            // Account tab); fetch it alongside so the Balance card paints complete.
            const [bal, sum, daily, monthDaily, rates, expiry] = await Promise.all([
                DashieAuth.dbRequest('get_credit_balance', {}),
                DashieAuth.dbRequest('get_usage_summary', { range_start: start, range_end: end, tz }),
                DashieAuth.dbRequest('get_usage_daily',   { range_start: start, range_end: end, tz }),
                DashieAuth.dbRequest('get_usage_daily',   { range_start: statStart, range_end: nowIso, tz }),
                DashieAuth.dbRequest('get_credit_rates',  {}).catch(() => null),
                DashieAuth.dbRequest('get_credit_expiry', {}).catch(() => null),
                CreditsControls.fetchAutorefill().catch(() => null),
            ]);
            this._balance = bal;
            this._summary = sum;
            this._daily = daily;
            this._monthDaily = monthDaily;
            this._rates = rates;
            this._expiry = expiry;
            // Share the freshly-fetched balance with the sidebar so its
            // bottom-left widget never disagrees with the stat strip on
            // this page. CreditsService re-renders the sidebar in-place.
            window.CreditsService?.note(bal);
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
            this._expandedMonths.clear();
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
        this._expandedMonths.clear();
        this._fetchAll();
    },

    /** Compute start + end ISO strings for the active range. */
    _rangeBounds() {
        const now = new Date();
        const endIso = now.toISOString();
        let start;
        switch (this._activeRange) {
            case 'today': {
                const s = new Date(now); s.setHours(0, 0, 0, 0); start = s.toISOString(); break;  // local midnight
            }
            case '7d':    start = new Date(now.getTime() - 7 * 86400_000).toISOString(); break;
            case 'month': {
                const s = new Date(now.getFullYear(), now.getMonth(), 1);  // local month start
                start = s.toISOString(); break;
            }
            case 'year': {
                const s = new Date(now.getFullYear(), 0, 1);  // local Jan 1
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

    /** USD cost for a summary row.
     *
     *  Authoritative source: `row.actual_cost_usd` is what the server
     *  actually debited from user_credits.balance for this group (from
     *  credit_deductions). Use that when present.
     *
     *  Fallback: historical rows from before credit_deductions existed
     *  have actual_cost_usd === 0 but real token counts in ai_interactions
     *  / token_usage. For those we compute client-side from the catalog
     *  so the table doesn't suddenly drop the old spend to zero. TTS/STT
     *  has no token columns, so the fallback only produces a number for
     *  ai/web_search. */
    _costForRow(row) {
        // Cost = the ACTUAL margined charge (sum of credit_deductions.amount).
        // No token-compute fallback — mixing computed (pre-margin) with actual is
        // exactly what made the summary, daily, and stat-card totals disagree.
        // Now every total == the sum of credit_deductions for the range.
        return row ? (Number(row.actual_cost_usd) || 0) : 0;
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
        return { ai: 'AI Models', tts: 'Speech (TTS)', stt: 'Speech (STT)', web_search: 'Tools' }[svc] || svc;
    },

    /** Display name for a summary line. Web-search rows read as the tool name —
     *  "Tavily (web search)" — so the Tools group is human-readable as we add more. */
    _summaryItemName(r) {
        if (r.service === 'web_search') {
            const p = r.provider ? r.provider.charAt(0).toUpperCase() + r.provider.slice(1) : 'Web';
            return `${p} (web search)`;
        }
        return r.model || r.provider || '—';
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
            const result = await DashieAuth.dbRequest('get_usage_calls', { date, tz: this._tz() });
            const interactions = result.interactions || [];
            await this._mergeLocalTranscripts(interactions);
            this._expandedDays.set(date, { loading: false, interactions });
        } catch (e) {
            this._expandedDays.set(date, { loading: false, error: e?.message || String(e) });
        }
        App.renderPage();
    },

    /** In add-on mode, overlay HA-local transcript text onto interactions by
     *  session_id. Kiosk turns keep transcripts on the user's HA box (not
     *  Supabase), so the Supabase usage rows carry cost but no text — we fetch
     *  the text from the add-on and join it here. Best-effort. Build plan §17. */
    async _mergeLocalTranscripts(interactions) {
        if (typeof DashieAuth === 'undefined' || !DashieAuth.isAddonMode) return;
        if (!interactions.length) return;
        // Cloud-account rows already carry their text from Supabase — nothing to join.
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
                if (t) { intr.prompt = t.text || null; intr.response = t.voice || null; }
            }
        } catch (e) {
            // Transcripts just won't show; never block the usage view.
        }
    },

    /** Expand/collapse a single voice interaction (its passes/items). */
    toggleInteraction(key) {
        if (this._expandedInteractions.has(key)) this._expandedInteractions.delete(key);
        else this._expandedInteractions.add(key);
        App.renderPage();
    },

    /** Expand/collapse a service group (AI / Speech / Tools) in the summary. */
    toggleService(svc) {
        if (this._expandedServices.has(svc)) this._expandedServices.delete(svc);
        else this._expandedServices.add(svc);
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
                ${this._renderFlash()}
                ${this._renderStatStrip()}
                ${CreditsControls.renderExpiryNotice(this._expiry)}
                ${this._renderAdminSection()}
                ${this._renderRangeBar()}
                ${this._renderSummaryCard()}
                ${this._renderBreakdownCard()}
                ${this._renderPricingCard()}
            </div>`;
    },

    _renderFlash() {
        if (!this._flash) return '';
        return `
            <div class="card" style="margin-bottom: 12px; border-color: var(--status-success, #16a34a);">
                <div class="card-body" style="padding: 12px 16px; font-size: 13px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
                    <span>${this._escape(this._flash)}</span>
                    <button class="btn btn-secondary btn-sm" onclick="AccountUsage.dismissFlash()">Dismiss</button>
                </div></div>`;
    },
    dismissFlash() { this._flash = null; App.renderPage(); },

    /** Credit Pricing table — customer-facing (already margined) rate per tool
     *  with a short description. Source: get_credit_rates. Build plan §11. */
    _renderPricingCard() {
        const rates = this._rates?.rates || [];
        if (!rates.length) return '';
        const fmtRate = (r) => r.included
            ? `<span style="color: var(--status-success, #16a34a); font-weight: 600;">Included</span>`
            : (r.rates || []).map(x =>
                `<span style="white-space: nowrap;">${x.label ? this._escape(x.label) + ' ' : ''}<span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600;">${this._fmtRateAmount(x.amount)}</span> <span style="color: var(--text-muted);">${this._escape(x.unit)}</span></span>`
            ).join('<span style="color: var(--text-muted); margin: 0 8px;">·</span>');
        const rows = rates.map(r => `
            <div style="padding: 14px 16px; border-top: 1px solid var(--border, #e5e7eb);">
                <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap;">
                    <div style="font-weight: 600; font-size: 14px;">${this._escape(r.title)}
                        ${r.subtitle ? `<span style="color: var(--text-muted); font-weight: 400; font-size: 12px;"> · ${this._escape(r.subtitle)}</span>` : ''}
                    </div>
                    <div style="font-size: 13px; text-align: right;">${fmtRate(r)}</div>
                </div>
                ${r.description ? `<div style="color: var(--text-muted); font-size: 12px; line-height: 1.5; margin-top: 4px;">${this._escape(r.description)}</div>` : ''}
            </div>`).join('');
        return `
            <div class="card" style="margin-top: 20px;"><div class="card-body" style="padding: 0;">
                <div style="padding: 12px 16px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">
                    Credit Pricing
                </div>
                ${rows}
                <div style="padding: 12px 16px; border-top: 1px solid var(--border, #e5e7eb); color: var(--text-muted); font-size: 11px; line-height: 1.5;">
                    Rates are what you pay in credits (1 credit = $1 USD). Most interactions cost well under a cent.
                </div>
            </div></div>`;
    },

    /** Format a small per-unit rate — more precision than _fmtCost since rates
     *  like $0.0096/search would otherwise round to $0.01. */
    _fmtRateAmount(amount) {
        const n = Number(amount) || 0;
        if (n === 0) return '$0';
        if (n < 0.01) return `$${n.toFixed(4)}`;
        if (n < 1) return `$${n.toFixed(3)}`;
        return `$${n.toFixed(2)}`;
    },

    _renderStatStrip() {
        // Balance card on the left; one combined period card (Today / This week /
        // This month) on the right. All three totals are range-INDEPENDENT (read
        // from the dedicated stat-window fetch, not the selected range).
        const todayCost = this._totalCostForDay(this._todayDate());
        const weekCost = this._totalCostForWeek();
        const monthCost = this._totalCostForMonth();
        return `
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; align-items: stretch;">
                ${CreditsControls.renderBalanceCard(this._balance)}
                ${this._renderPeriodCard(todayCost, weekCost, monthCost)}
            </div>`;
    },

    /** Combined Today / This week / This month card. Fills its grid cell so its
     *  height matches the Balance card beside it (align-items: stretch). */
    _renderPeriodCard(today, week, month) {
        const row = (label, val) => `
            <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px;">
                <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">${label}</span>
                <span style="font-size: 20px; font-weight: 700; color: var(--text-primary);">${val == null ? '—' : this._escape(this._fmtCost(val))}</span>
            </div>`;
        return `
            <div class="card" style="height: 100%;"><div class="card-body" style="height: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; gap: 10px; padding: 16px;">
                ${row('Today', today)}
                ${row('This week', week)}
                ${row('This month', month)}
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
        const ranges = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month'], ['year', 'This year']];
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
            const open = this._expandedServices.has(svc);
            const caret = open ? '▾' : '▸';
            const itemRows = open ? items.map(r => this._summaryItemRow(r)).join('') : '';
            return `
                <tr><td colspan="4" onclick="AccountUsage.toggleService('${svc}')"
                    style="padding: 14px 12px 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); cursor: pointer;">
                    <span style="display: inline-block; width: 12px; color: var(--text-muted);">${caret}</span>
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
                <td style="padding: 8px 12px 8px 36px; font-size: 13px; width: 35%;">${this._escape(this._summaryItemName(r))}</td>
                <td style="padding: 8px 12px; font-size: 12px; color: var(--text-muted);">${this._escape(r.provider || '')}</td>
                <td style="padding: 8px 12px; font-size: 12px; color: var(--text-muted); text-align: right;">${this._fmtCount(r.call_count)} · ${this._escape(subtitle)}</td>
                <td style="padding: 8px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; text-align: right;">${this._fmtCost(cost)}</td>
            </tr>`;
    },

    /** Breakdown card: header + view selector (List / Daily Graph / Monthly Graph)
     *  over the body. List is the per-day drill-down (month-grouped in year range);
     *  the graphs are stacked AI/Speech/Tools bars from UsageChart. */
    _renderBreakdownCard() {
        const days = this._daily?.days || [];
        if (days.length === 0) return '';
        return `
            <div class="card"><div class="card-body" style="padding: 0;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding: 10px 16px; border-bottom: 1px solid var(--border, #e5e7eb);">
                    <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">Breakdown</span>
                    ${this._renderBreakdownSelector()}
                </div>
                ${this._renderBreakdownBody(days)}
            </div></div>`;
    },

    _renderBreakdownSelector() {
        const views = [['list', 'List'], ['daily', 'Daily Graph'], ['monthly', 'Monthly Graph']];
        return `<div style="display:inline-flex; gap:4px;">
            ${views.map(([id, label]) => `
                <button class="btn ${this._breakdownView === id ? 'btn-primary' : 'btn-secondary'} btn-sm"
                    onclick="AccountUsage.setBreakdownView('${id}')">${label}</button>`).join('')}
        </div>`;
    },

    setBreakdownView(v) {
        if (v === this._breakdownView) return;
        this._breakdownView = v;
        App.renderPage();
    },

    _renderBreakdownBody(days) {
        if (this._breakdownView === 'daily') {
            // Span the range ascending (earliest left) with missing days filled as
            // zero bars (gaps), then trim the empty run before the first / after
            // the last day with usage, then cap to the most recent N.
            const filled = this._filledDays();
            const all = UsageChart.trimEmptyEnds(UsageChart.dayBuckets(filled, this._chartBucketFn, this._chartCostFn));
            const cap = this.DAILY_GRAPH_CAP;
            const capped = all.length > cap ? all.slice(-cap) : all;
            const note = all.length > cap
                ? `Showing the most recent ${cap} days — switch to Monthly Graph for the full range.`
                : '';
            return UsageChart.render(capped, { note });
        }
        if (this._breakdownView === 'monthly') {
            return UsageChart.render(UsageChart.trimEmptyEnds(UsageChart.monthBuckets(this._filledDays(), this._chartBucketFn, this._chartCostFn)));
        }
        // List view — month-grouped in year range, flat day rows otherwise.
        return this._activeRange === 'year'
            ? this._renderYearList(days)
            : days.map(d => this._renderDayRow(d)).join('');
    },

    /** row → chart bucket key ('ai' | 'speech' | 'tools'). Reuses _svcGroup
     *  (tts/stt → speech) and folds web_search → tools. Bound for UsageChart. */
    _chartBucketFn(r) {
        const g = AccountUsage._svcGroup(r.service);
        return g === 'web_search' ? 'tools' : g;
    },
    _chartCostFn(r) { return AccountUsage._costForRow(r); },

    /** Complete ascending day list across the active range, merging the sparse
     *  server rows in and filling absent days with an empty bucket — so the
     *  graphs sort earliest-first and render gaps where there was no usage. */
    _filledDays() {
        const byDate = new Map((this._daily?.days || []).map(d => [d.date, d]));
        const { start, end } = this._rangeBounds();
        const out = [];
        const cur = this._localMidnight(new Date(start));
        const last = this._localMidnight(new Date(end));
        for (let i = 0; cur <= last && i < 800; i++) {        // 800 = safety cap for custom ranges
            const ds = cur.toLocaleDateString('en-CA');       // local 'YYYY-MM-DD'
            out.push(byDate.get(ds) || { date: ds, by_service: [] });
            cur.setDate(cur.getDate() + 1);
        }
        return out;
    },

    _localMidnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); },

    // ── year list: current month daily, prior months collapsed ──

    _renderYearList(days) {
        const sorted = [...days].sort((a, b) => (a.date < b.date ? 1 : -1));   // newest first
        const curPrefix = new Date().toLocaleDateString('en-CA').slice(0, 7);   // local 'YYYY-MM'
        const current = sorted.filter(d => d.date.startsWith(curPrefix));
        const prior = sorted.filter(d => !d.date.startsWith(curPrefix));
        // Preserve newest-first month order while grouping.
        const order = [], byMonth = new Map();
        for (const d of prior) {
            const ym = d.date.slice(0, 7);
            if (!byMonth.has(ym)) { byMonth.set(ym, []); order.push(ym); }
            byMonth.get(ym).push(d);
        }
        return current.map(d => this._renderDayRow(d)).join('')
            + order.map(ym => this._renderMonthGroup(ym, byMonth.get(ym))).join('');
    },

    _renderMonthGroup(ym, monthDays) {
        const open = this._expandedMonths.has(ym);
        const caret = open ? '▾' : '▸';
        const allRows = monthDays.flatMap(d => d.by_service || []);
        const total = allRows.reduce((s, r) => s + this._costForRow(r), 0);
        const pills = this._dayServicePills(allRows);
        const detail = open ? monthDays.map(d => this._renderDayRow(d)).join('') : '';
        return `
            <div style="border-bottom: 1px solid var(--border, #e5e7eb);">
                <div onclick="AccountUsage.toggleMonth('${ym}')"
                    style="display:flex; align-items:center; gap:12px; padding:10px 16px; cursor:pointer; background:var(--surface-muted,#fafafa);">
                    <span style="color:var(--text-muted); width:12px;">${caret}</span>
                    <span style="font-size:13px; font-weight:600; min-width:110px;">${this._escape(this._fmtMonthLong(ym))}</span>
                    <span style="flex:1; font-size:12px; color:var(--text-muted);">${pills}</span>
                    <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px; font-weight:600;">${this._fmtCost(total)}</span>
                </div>
                ${detail}
            </div>`;
    },

    toggleMonth(ym) {
        if (this._expandedMonths.has(ym)) this._expandedMonths.delete(ym);
        else this._expandedMonths.add(ym);
        App.renderPage();
    },

    _fmtMonthLong(ym) {
        try {
            const [y, m] = ym.split('-').map(Number);
            return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
        } catch { return ym; }
    },

    _renderDayRow(d) {
        const expanded = this._expandedDays.get(d.date);
        const total = (d.by_service || []).reduce((sum, r) => sum + this._costForRow(r), 0);
        const pills = this._dayServicePills(d.by_service || []);
        const count = d.interaction_count;
        const sparkline = (count != null)
            ? `${count} Voice Interaction${count === 1 ? '' : 's'}${pills ? ` (${pills})` : ''}`
            : pills;
        const caret = expanded ? '▾' : '▸';

        let detail = '';
        if (expanded) {
            if (expanded.loading) {
                detail = `<div style="padding: 12px 32px; color: var(--text-muted); font-size: 13px;">Loading calls…</div>`;
            } else if (expanded.error) {
                detail = `<div style="padding: 12px 32px; color: var(--status-error, #c00); font-size: 13px;">Error: ${this._escape(expanded.error)}</div>`;
            } else {
                const interactions = expanded.interactions || [];
                if (interactions.length === 0) {
                    detail = `<div style="padding: 12px 32px; color: var(--text-muted); font-size: 13px;">No calls recorded.</div>`;
                } else {
                    detail = `<div style="padding: 2px 16px 10px 40px;">
                        ${interactions.map(i => this._renderInteractionRow(i)).join('')}
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

    // TTS + STT are both "Speech"; group them so the breakdown reads naturally.
    _svcGroup(svc) { return (svc === 'tts' || svc === 'stt') ? 'speech' : svc; },
    _svcLabel(svc) { return { ai: 'AI', speech: 'Speech', tts: 'Speech', stt: 'Speech', web_search: 'Search' }[svc] || svc; },
    _SVC_ORDER: { ai: 0, speech: 1, web_search: 2 },

    _dayServicePills(rows) {
        const byService = new Map();
        for (const r of rows) {
            const cost = this._costForRow(r);
            const g = this._svcGroup(r.service);
            byService.set(g, (byService.get(g) || 0) + cost);
        }
        return Array.from(byService.entries())
            .filter(([_, c]) => c > 0)
            .sort((a, b) => (this._SVC_ORDER[a[0]] ?? 9) - (this._SVC_ORDER[b[0]] ?? 9))
            .map(([svc, c]) => `${this._svcLabel(svc)} ${this._fmtCost(c)}`)
            .join(' · ');
    },

    /** USD cost of a single drill-down item. Prefers the ACTUAL margined charge
     *  debited for this call (joined server-side from credit_deductions) — it
     *  matches the day total and is the only way to cost TTS/STT, which have no
     *  token-based estimate (that's why those line items used to read $0.00).
     *  Falls back to a client-side catalog estimate for legacy rows that predate
     *  credit_deductions. */
    _itemCost(c) {
        if (c.actual_cost_usd != null) return Number(c.actual_cost_usd) || 0;
        const C = window.AiModelCatalog;
        if (!C) return 0;
        if (c.service === 'ai') {
            const rates = c.model ? C.pricingFor(c.model) : null;
            if (!rates) return 0;
            return ((c.input_tokens || 0) * rates[0] + (c.output_tokens || 0) * rates[1]) / 1_000_000;
        }
        if (c.service === 'web_search') {
            return C.searchCost({ provider: c.provider, count: 1 });
        }
        return 0;
    },

    /** One voice interaction (a turn): summary row, expandable to its items. */
    _renderInteractionRow(intr) {
        const items = intr.items || [];
        const total = items.reduce((s, c) => s + this._itemCost(c), 0);
        const open = this._expandedInteractions.has(intr.key);
        const caret = open ? '▾' : '▸';
        const time = (() => {
            try { return new Date(intr.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
            catch { return intr.ts; }
        })();
        const counts = {};
        for (const it of items) { const g = this._svcGroup(it.service); counts[g] = (counts[g] || 0) + 1; }
        const mix = Object.entries(counts)
            .sort((a, b) => (this._SVC_ORDER[a[0]] ?? 9) - (this._SVC_ORDER[b[0]] ?? 9))
            .map(([s, n]) => {
                // AI with 2+ passes = a two-pass (tool/complex) turn; 1 pass = simple.
                // Mirrors the COMPLEX/SIMPLE badge in the Recent Interactions tab.
                if (s === 'ai') return n >= 2 ? 'AI (complex)' : 'AI (simple)';
                return `${this._svcLabel(s)}${n > 1 ? ' ×' + n : ''}`;
            })
            .join(' · ');
        const body = open
            ? `<div style="padding-left: 24px;">
                 ${this._renderTranscript(intr)}
                 <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin: 0 0 6px;"><tbody>
                    ${items.map(c => this._renderCallRow(c)).join('')}
                 </tbody></table>
               </div>`
            : '';
        return `
            <div style="border-bottom: 1px solid var(--border, #f0f0f0);">
                <div onclick="event.stopPropagation(); AccountUsage.toggleInteraction('${this._escape(intr.key)}')"
                    style="display: flex; align-items: center; gap: 10px; padding: 7px 0; cursor: pointer;">
                    <span style="color: var(--text-muted); width: 12px; font-size: 11px;">${caret}</span>
                    <span style="color: var(--text-muted); width: 76px; font-size: 12px;">${this._escape(time)}</span>
                    <span style="flex: 1; font-size: 12px;">${this._escape(mix)} · ${items.length} call${items.length === 1 ? '' : 's'}</span>
                    <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 600;">${this._fmtCost(total)}</span>
                </div>
                ${body}
            </div>`;
    },

    /** Retained transcript for one interaction (only present when the account
     *  opted into "Keep transcripts"). Build plan §17. */
    _renderTranscript(intr) {
        if (!intr || (!intr.prompt && !intr.response)) return '';
        const line = (label, val) => `
            <div style="margin: 0 0 4px;">
                <span style="color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">${label}</span>
                <div style="font-size: 12px; line-height: 1.4;">${this._escape(val)}</div>
            </div>`;
        return `
            <div style="background: var(--surface-muted, #f7f7f8); border-radius: 8px; padding: 8px 10px; margin: 0 0 8px;">
                ${intr.prompt ? line('You said', intr.prompt) : ''}
                ${intr.response ? line('Dashie replied', intr.response) : ''}
            </div>`;
    },

    _renderCallRow(c) {
        const cost = this._itemCost(c);
        // Per-call time is redundant — the interaction header already shows it
        // (every pass of one turn lands within the same minute).
        const desc = c.service === 'ai'
            ? `${this._escape(c.model || '—')} (${this._fmtCount(c.input_tokens)} in / ${this._fmtCount(c.output_tokens)} out)`
            : c.service === 'web_search'
                ? `${this._escape(c.provider || '')} (${this._fmtCount(c.result_count || 0)} results)`
                : `${this._escape(c.provider || '')} ${c.service}`;
        return `
            <tr>
                <td style="padding: 4px 0; color: var(--text-muted); width: 60px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px;">${this._escape(this._svcLabel(c.service))}</td>
                <td style="padding: 4px 8px;">${desc}</td>
                <td style="padding: 4px 0; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${this._fmtCost(cost)}</td>
            </tr>`;
    },

    // ── helpers used by stat strip ───────────────────────────

    /** The browser's IANA timezone, sent to the server for local-day bucketing. */
    _tz() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; }
        catch { return null; }
    },

    _todayDate() {
        // Local calendar day ('YYYY-MM-DD'), matching the server's local bucketing.
        return new Date().toLocaleDateString('en-CA');
    },

    _totalCostForDay(dateStr) {
        // Range-independent: always read the current-month fetch, not the selected range.
        if (!this._monthDaily?.days) return null;
        const row = this._monthDaily.days.find(d => d.date === dateStr);
        if (!row) return 0;
        return (row.by_service || []).reduce((sum, r) => sum + this._costForRow(r), 0);
    },

    _totalCostForMonth() {
        // Range-independent: always read the current-month fetch.
        if (!this._monthDaily?.days) return null;
        const prefix = new Date().toLocaleDateString('en-CA').slice(0, 7) + '-';  // local 'YYYY-MM-'
        return this._monthDaily.days
            .filter(d => d.date.startsWith(prefix))
            .reduce((sum, d) => sum + (d.by_service || []).reduce((s, r) => s + this._costForRow(r), 0), 0);
    },

    /** Local calendar week start (Sunday 00:00). Drives the stat-window fetch and
     *  the "This week" total. For a Monday-start week, replace `- d.getDay()` with
     *  `- ((d.getDay() + 6) % 7)`. */
    _weekStart() {
        const now = new Date();
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        d.setDate(d.getDate() - d.getDay());  // back up to Sunday
        return d;
    },

    _totalCostForWeek() {
        // Range-independent: read the dedicated stat-window fetch (covers the week
        // even when it spans into the prior month).
        if (!this._monthDaily?.days) return null;
        const ws = this._weekStart().toLocaleDateString('en-CA');  // local 'YYYY-MM-DD'
        return this._monthDaily.days
            .filter(d => d.date >= ws)
            .reduce((sum, d) => sum + (d.by_service || []).reduce((s, r) => s + this._costForRow(r), 0), 0);
    },

    _escape(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
};

window.AccountUsage = AccountUsage;
