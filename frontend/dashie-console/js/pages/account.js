/* ============================================================
   Account & Credits Page
   ============================================================ */

const AccountPage = {
    _data: null,
    _loading: false,
    _error: null,

    render() {
        // Kick off data fetch if not loaded
        if (!this._data && !this._loading && !this._error) {
            this._fetchData();
            return this._renderLoading();
        }

        if (this._loading) return this._renderLoading();
        if (this._error) return this._renderError();
        return this._renderLoaded();
    },

    topBarTitle() { return 'Account & Credits'; },
    topBarSubtitle() { return ''; },

    // =========================================================

    async _fetchData() {
        this._loading = true;
        this._error = null;
        try {
            // Use the authenticated user ID from DashieAuth
            const response = await DashieAuth.edgeFunctionRequest('check-subscription', {
                auth_user_id: DashieAuth.jwtUserId,
            });
            this._data = response;
            this._loading = false;
            App.renderPage();
        } catch (e) {
            console.error('[AccountPage] Fetch failed:', e);
            this._error = e.message;
            this._loading = false;
            App.renderPage();
        }
    },

    _renderLoading() {
        return `
            <div style="display: flex; align-items: center; justify-content: center; padding: 60px;">
                <div style="text-align: center;">
                    <div class="spinner" style="width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 12px;"></div>
                    <div style="color: var(--text-secondary); font-size: var(--font-size-sm);">Loading account...</div>
                </div>
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
            </div>
        `;
    },

    _renderError() {
        return `
            <div class="card">
                <div class="card-body" style="color: var(--status-error);">
                    <strong>Failed to load account data:</strong> ${this._error}
                    <div style="margin-top: 12px;">
                        <button class="btn btn-secondary btn-sm" onclick="AccountPage._retry()">Retry</button>
                    </div>
                </div>
            </div>
        `;
    },

    _retry() {
        this._error = null;
        this._data = null;
        App.renderPage();
    },

    _renderLoaded() {
        const user = DashieAuth.user;
        const d = this._data || {};

        // Subscription display
        const statusDisplay = this._formatStatus(d.subscription_status, d.tier_expires_at);
        const planLabel = this._formatPlan(d.subscription_plan);

        // Credits (not yet wired to backend — show zeros until Phase 2)
        const credits = { included: 0, purchased: 0, total: 0 };

        return `
            <div style="margin-bottom: 24px; color: var(--text-secondary); font-size: var(--font-size-sm);">
                ${user.email} · Signed in via Google
            </div>

            <div class="stat-cards">
                ${Card.stat('Plan', statusDisplay.label, statusDisplay.detail)}
                ${Card.stat('Tier', this._formatTier(d.tier), d.has_voice_license ? 'Voice license active' : '')}
                ${Card.stat('Credits', `$${credits.total.toFixed(2)}`, 'Coming in Phase 2')}
            </div>

            <div class="section-header">Subscription Status</div>
            <div class="card">
                <div class="card-body">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: var(--text-secondary);">Status</span>
                        <span style="font-weight: 600;">${statusDisplay.label}</span>
                    </div>
                    ${d.tier_expires_at ? `
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span style="color: var(--text-secondary);">${d.subscription_status === 'trialing' ? 'Trial ends' : 'Renews / expires'}</span>
                            <span style="font-weight: 500;">${this._formatDate(d.tier_expires_at)}</span>
                        </div>
                    ` : ''}
                    ${d.trial_reason ? `
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span style="color: var(--text-secondary);">Trial reason</span>
                            <span style="font-weight: 500;">${this._formatTrialReason(d.trial_reason)}</span>
                        </div>
                    ` : ''}
                    ${planLabel ? `
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: var(--text-secondary);">Plan</span>
                            <span style="font-weight: 500;">${planLabel}</span>
                        </div>
                    ` : ''}
                </div>
            </div>

            <div class="section-header">Credits & Usage</div>
            <div class="card">
                <div class="card-body" style="color: var(--text-secondary); text-align: center; padding: 32px 16px;">
                    <div style="font-size: var(--font-size-lg); color: var(--text-primary); margin-bottom: 6px;">Per-token billing coming soon</div>
                    <div style="font-size: var(--font-size-sm);">Credit balance, usage tracking, and top-ups ship in Phase 2.</div>
                </div>
            </div>

            <div style="margin-top: 24px; display: flex; gap: 12px;">
                <button class="btn btn-secondary" onclick="window.open('https://dashieapp.com/account', '_blank')">Manage Subscription</button>
                <button class="btn btn-ghost" onclick="AccountPage.signOut()">Sign Out</button>
            </div>
        `;
    },

    _formatStatus(status, expiresAt) {
        const statusMap = {
            trialing: { label: 'Trial Active', detail: expiresAt ? `Ends ${this._formatDate(expiresAt)}` : '' },
            active: { label: 'Active', detail: expiresAt ? `Renews ${this._formatDate(expiresAt)}` : '' },
            trial_expired: { label: 'Trial Ended', detail: 'Subscribe to continue' },
            past_due: { label: 'Payment Issue', detail: 'Update at dashieapp.com/account' },
            canceled: { label: 'Canceled', detail: expiresAt ? `Expires ${this._formatDate(expiresAt)}` : '' },
            complimentary: { label: 'Complimentary', detail: 'Comp account' },
        };
        return statusMap[status] || { label: status || 'Unknown', detail: '' };
    },

    _formatPlan(plan) {
        if (!plan) return '';
        const planMap = {
            dashie_monthly: '$2.99/month',
            dashie_annual: '$29.99/year',
        };
        return planMap[plan] || plan;
    },

    _formatTier(tier) {
        if (!tier) return 'Unknown';
        return tier.charAt(0).toUpperCase() + tier.slice(1);
    },

    _formatTrialReason(reason) {
        const reasonMap = {
            voice_license_purchase: 'Voice license bonus',
            voice_license_retroactive: 'Voice license bonus',
            standard: 'Standard trial',
        };
        return reasonMap[reason] || reason;
    },

    _formatDate(isoDate) {
        if (!isoDate) return '—';
        try {
            const d = new Date(isoDate);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (e) {
            return isoDate;
        }
    },

    // =========================================================

    signOut() {
        if (confirm('Sign out of Dashie Console?')) {
            DashieAuth.signOut();
            this._data = null;
            App._showLogin();
        }
    },
};
