/* ============================================================
   Feature Adoption Page (admin / alpha-only)

   One row per Dashie cloud account with a snapshot of which core
   features they've configured: calendars, weather zip, photos —
   plus devices and last-seen recency. Data comes from the
   service-role `get_feature_adoption` operation (admin-gated).

   Phase 1: calendars, weather, photos. Voice / locations / chores /
   rewards columns will be added once their adoption signals are
   wired (see handlers/admin-adoption.ts).
   ============================================================ */

const FeatureAdoptionPage = {
    _users: null,
    _loading: false,
    _error: null,

    // device_type → short label
    DEVICE_LABELS: {
        tv_firetv: 'Fire TV',
        tv_googletv: 'Google TV',
        tv_onn: 'Onn TV',
        tv_androidtv: 'Android TV',
        tablet_android: 'Tablet',
        web: 'Web',
    },

    render() {
        if (!this._users && !this._loading && !this._error) {
            this._fetch();
            return this._renderLoading();
        }
        if (this._loading && !this._users) return this._renderLoading();
        if (this._error && !this._users) return this._renderError();
        return this._renderTable();
    },

    topBarTitle() { return 'Feature Adoption'; },
    topBarSubtitle() {
        if (!this._users) return '';
        return `${this._users.length} account${this._users.length === 1 ? '' : 's'}`;
    },
    topBarActions() {
        return `<button class="btn btn-secondary" onclick="FeatureAdoptionPage._retry()">Refresh</button>`;
    },

    // Re-fetch when navigated to so numbers stay fresh.
    onNavigateTo() {
        this._users = null;
        this._error = null;
    },

    // =========================================================

    async _fetch() {
        this._loading = true;
        this._error = null;
        try {
            const result = await DashieAuth.dbRequest('get_feature_adoption', {});
            this._users = result.users || [];
        } catch (e) {
            console.error('[FeatureAdoptionPage] Fetch failed:', e);
            this._error = e.message;
        } finally {
            this._loading = false;
            App.renderPage();
        }
    },

    _retry() {
        this._users = null;
        this._error = null;
        App.renderPage();
    },

    // =========================================================
    //  Rendering
    // =========================================================

    _renderTable() {
        if (!this._users.length) {
            return `<div class="card"><div class="card-body">No accounts found.</div></div>`;
        }

        // Summary counts across all accounts.
        const total = this._users.length;
        const withCal = this._users.filter(u => u.calendar_count > 0).length;
        const withZip = this._users.filter(u => u.zip_code).length;
        const withPhotos = this._users.filter(u => u.photo_count > 0).length;

        const rows = this._users.map(u => this._row(u)).join('');

        return `
            <div class="adoption-summary">
                ${this._summaryCard('Accounts', total)}
                ${this._summaryCard('Calendars set', `${withCal} / ${total}`)}
                ${this._summaryCard('Weather zip', `${withZip} / ${total}`)}
                ${this._summaryCard('Photos added', `${withPhotos} / ${total}`)}
            </div>

            <div class="adoption-table-wrap card">
                <table class="adoption-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Signed up</th>
                            <th>Last seen</th>
                            <th>Devices</th>
                            <th class="num">Calendars</th>
                            <th>Zip</th>
                            <th>Photos</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    },

    _summaryCard(label, value) {
        return `
            <div class="adoption-stat">
                <div class="adoption-stat-value">${value}</div>
                <div class="adoption-stat-label">${label}</div>
            </div>
        `;
    },

    _row(u) {
        const name = u.first_name ? this._escape(u.first_name) : '';
        const email = this._escape(u.email || '');
        const tag = u.is_ha_user ? '<span class="adoption-tag">HA</span>' : '';

        const devices = (u.device_types || [])
            .map(t => this.DEVICE_LABELS[t] || t)
            .join(', ') || '—';

        const cal = u.calendar_count > 0
            ? `<span class="adoption-yes">${u.calendar_count}</span>`
            : '<span class="adoption-no">0</span>';

        const zip = u.zip_code
            ? `<span class="adoption-yes">${this._escape(u.zip_code)}</span>`
            : '<span class="adoption-no">—</span>';

        const photos = u.photo_count > 0
            ? `<span class="adoption-yes">${u.photo_count}</span> <span class="adoption-muted">${this._escape((u.photo_sources || []).join(', '))}</span>`
            : '<span class="adoption-no">—</span>';

        return `
            <tr>
                <td>
                    <div class="adoption-user">${name}${tag}</div>
                    <div class="adoption-email">${email}</div>
                </td>
                <td>${this._fmtDate(u.created_at)}</td>
                <td>${this._fmtRelative(u.last_seen_at)}</td>
                <td>${this._escape(devices)}</td>
                <td class="num">${cal}</td>
                <td>${zip}</td>
                <td>${photos}</td>
            </tr>
        `;
    },

    _renderLoading() {
        return `
            <div style="display: flex; align-items: center; justify-content: center; padding: 60px;">
                <div style="text-align: center;">
                    <div style="width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 12px;"></div>
                    <div style="color: var(--text-secondary); font-size: var(--font-size-sm);">Loading adoption data...</div>
                </div>
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
            </div>
        `;
    },

    _renderError() {
        return `
            <div class="card">
                <div class="card-body" style="color: var(--status-error);">
                    <strong>Failed to load adoption data:</strong> ${this._escape(this._error)}
                    <div style="margin-top: 12px;">
                        <button class="btn btn-secondary btn-sm" onclick="FeatureAdoptionPage._retry()">Retry</button>
                    </div>
                </div>
            </div>
        `;
    },

    // =========================================================
    //  Formatting helpers
    // =========================================================

    _fmtDate(iso) {
        if (!iso) return '<span class="adoption-no">—</span>';
        const d = new Date(iso);
        if (isNaN(d)) return '<span class="adoption-no">—</span>';
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    },

    _fmtRelative(iso) {
        if (!iso) return '<span class="adoption-no">never</span>';
        const d = new Date(iso);
        if (isNaN(d)) return '<span class="adoption-no">—</span>';
        const days = Math.floor((Date.now() - d.getTime()) / 86400000);
        let label;
        if (days <= 0) label = 'today';
        else if (days === 1) label = 'yesterday';
        else if (days < 30) label = `${days}d ago`;
        else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        // Highlight accounts active within the last 2 days.
        const cls = days <= 2 ? 'adoption-yes' : (days >= 14 ? 'adoption-no' : '');
        return `<span class="${cls}">${label}</span>`;
    },

    _escape(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },
};
