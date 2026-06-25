/* ============================================================
   Account & Credits Page
   ============================================================ */

const AccountPage = {
    _data: null,
    _loading: false,
    _error: null,
    _expiry: null,           // {next_expiry:{amount,expires_at}, lots} — get_credit_expiry
    _transactions: null,     // [{kind,label,amount,unit,note,ts}] — get_transactions
    _subRenewsAt: null,      // ISO — active sub's next renewal (Stripe current_period_end)
    _showAllTx: false,       // "Show transaction history" expand
    _activeTab: 'account',   // 'account' | 'usage'

    setTab(tab) {
        if (tab !== 'account' && tab !== 'usage') return;
        this._activeTab = tab;
        if (tab === 'usage' && typeof AccountUsage !== 'undefined' && !AccountUsage._balance && !AccountUsage._loading) {
            AccountUsage._fetchAll();
        }
        App.renderPage();
    },

    render() {
        // Kick off data fetch if not loaded
        if (!this._data && !this._loading && !this._error) {
            this._fetchData();
            return this._renderLoading();
        }

        if (this._loading) return this._renderLoading();
        if (this._error) return this._renderError();

        const tabBar = this._renderTabBar();
        if (this._activeTab === 'usage' && typeof AccountUsage !== 'undefined') {
            return `${tabBar}${AccountUsage.render()}`;
        }
        return `${tabBar}${this._renderLoaded()}`;
    },

    /** Tab strip shared with the Token Usage subpage. Matches the Voice & AI
     *  page's tab pattern (same colors, same active-underline behavior). */
    _renderTabBar() {
        const tab = (id, label) => {
            const active = this._activeTab === id;
            return `
                <button onclick="AccountPage.setTab('${id}')"
                    style="background: none; border: none; padding: 10px 4px; cursor: pointer; font-size: 14px; font-weight: ${active ? '600' : '500'};
                           color: ${active ? 'var(--text-primary)' : 'var(--text-muted)'};
                           border-bottom: 2px solid ${active ? 'var(--accent)' : 'transparent'};
                           margin-bottom: -1px;">
                    ${label}
                </button>`;
        };
        return `
            <div style="display: flex; gap: 24px; border-bottom: 1px solid var(--border, #d1d5db); margin-bottom: 20px; max-width: 800px;">
                ${tab('account', 'Account')}
                ${tab('usage', 'Credit Usage')}
            </div>`;
    },

    topBarTitle() { return 'Account & Credits'; },
    topBarSubtitle() { return ''; },

    /** Top-bar action buttons. Hidden when expired — the page already has
     *  a Subscribe banner up top and a Subscribe button in the Subscription
     *  Status card; a third in the header would just be noise. */
    topBarActions() {
        const expired = typeof SubscribeGate !== 'undefined' && SubscribeGate.isRequired(this._data);
        if (expired) return '';
        return `
            <button class="btn btn-primary" onclick="AccountPage.openBillingPortal()" id="manage-subscription-btn">
                Manage Subscription
            </button>
        `;
    },

    /** Navigate to the subscribe page. Self-auth on subscribe.html picks
     *  up identity from the active Supabase session; we also pass the
     *  user/email explicitly as belt-and-suspenders. */
    subscribe() {
        const user = DashieAuth.user || {};
        const id = encodeURIComponent(user.id || '');
        const email = encodeURIComponent(user.email || '');
        window.location.href = `/subscribe.html?user=${id}&email=${email}`;
    },

    // =========================================================

    async _fetchData() {
        this._loading = true;
        this._error = null;
        try {
            // Use the authenticated user ID from DashieAuth. Fetch the credit
            // balance / auto-replenish / expiry alongside (alpha-only) so the
            // Credits card and section paint complete on first render.
            const showCredits = typeof FeatureGate !== 'undefined' && FeatureGate.shouldShow('credits');
            const [response] = await Promise.all([
                DashieAuth.edgeFunctionRequest('check-subscription', { auth_user_id: DashieAuth.jwtUserId }),
                showCredits ? CreditsService.fetch() : Promise.resolve(),
                showCredits ? CreditsControls.fetchAutorefill() : Promise.resolve(),
                showCredits ? DashieAuth.dbRequest('get_credit_expiry', {}).then(e => { this._expiry = e; }).catch(() => {}) : Promise.resolve(),
                showCredits ? DashieAuth.dbRequest('get_transactions', { limit: 50 }).then(r => {
                    // Only overwrite on a real array — a transient failure must not
                    // wipe the displayed list (was showing blank on navigate-back).
                    if (Array.isArray(r?.transactions)) this._transactions = r.transactions;
                    if (r?.subscription_renews_at) this._subRenewsAt = r.subscription_renews_at;
                }).catch(() => {}) : Promise.resolve(),
            ]);
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

    /** On re-entry, soft-refresh the credit/transaction data in place (no loading
     *  flash) so navigating back shows current data and self-heals a transient
     *  fetch failure (transactions/auto-replenish were going blank). First visit
     *  goes through render()'s _fetchData. */
    onNavigateTo() {
        if (this._data) this._refreshCredits();
    },

    async _refreshCredits() {
        const showCredits = typeof FeatureGate !== 'undefined' && FeatureGate.shouldShow('credits');
        if (!showCredits) return;
        await Promise.all([
            CreditsService.fetch({ force: true }).catch(() => {}),
            CreditsControls.fetchAutorefill({ force: true }).catch(() => {}),
            DashieAuth.dbRequest('get_credit_expiry', {}).then(e => { this._expiry = e; }).catch(() => {}),
            DashieAuth.dbRequest('get_transactions', { limit: 50 }).then(r => {
                if (Array.isArray(r?.transactions)) this._transactions = r.transactions;
                if (r?.subscription_renews_at) this._subRenewsAt = r.subscription_renews_at;
            }).catch(() => {}),
        ]);
        App.renderPage();
    },

    /** Transaction history — credit purchases, auto-replenish, admin grants, and
     *  monthly/annual subscription charges (Stripe). Shows the 5 most recent with
     *  a "Show transaction history" expand. */
    _renderTransactions() {
        const tx = this._transactions || [];
        if (!tx.length) return '';
        const shown = this._showAllTx ? tx : tx.slice(0, 5);
        const rows = shown.map(t => this._txRow(t)).join('');
        const more = (!this._showAllTx && tx.length > 5)
            ? `<div style="padding: 12px 16px; border-top: 1px solid var(--border, #e5e7eb);">
                   <a href="#" onclick="event.preventDefault(); AccountPage.showAllTransactions()" style="color: var(--accent); font-size: 13px;">Show transaction history (${tx.length})</a>
               </div>` : '';
        return `
            <div class="section-header" style="margin-top: 32px;">Transactions</div>
            <div class="card"><div class="card-body" style="padding: 0;">
                ${rows}${more}
            </div></div>`;
    },

    _txRow(t) {
        const date = (() => {
            try { return new Date(t.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
            catch { return t.ts; }
        })();
        // Subscription charges are payments ($); credit grants add credits (+$).
        const isCharge = t.kind === 'subscription_charge';
        const amt = `${isCharge ? '' : '+'}$${Number(t.amount || 0).toFixed(2)}`;
        const color = isCharge ? 'var(--text-primary)' : 'var(--status-success, #16a34a)';
        const sub = t.note ? ` · ${this._escape(t.note)}` : '';
        return `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--border, #f0f0f0);">
                <div>
                    <div style="font-weight: 500; font-size: 13px;">${this._escape(t.label)}</div>
                    <div style="color: var(--text-muted); font-size: 11px; margin-top: 2px;">${this._escape(date)}${sub}</div>
                </div>
                <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; font-size: 13px; color: ${color};">${amt}</div>
            </div>`;
    },

    showAllTransactions() { this._showAllTx = true; App.renderPage(); },

    _escape(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },


    _renderLoaded() {
        const user = DashieAuth.user;
        const d = this._data || {};

        // Credits: the same rich box used on the Credit Usage tab (balance +
        // Buy more + auto-replenish), reading from the shared CreditsService.
        // Gated alpha-only via FeatureGate.
        const showCredits = FeatureGate.shouldShow('credits');
        const expired = typeof SubscribeGate !== 'undefined' && SubscribeGate.isRequired(d);
        const isCancel = d.subscription_status === 'canceled';
        const bannerCopy = isCancel
            ? 'Your subscription has ended. Subscribe to keep using Dashie’s calendar, photos, family sharing, and more.'
            : 'Your trial has ended. Subscribe to keep using Dashie’s calendar, photos, family sharing, and more.';

        const banner = expired ? `
            <div class="card" style="margin-bottom: 16px; border-left: 4px solid var(--accent, #ffaa00); background: var(--bg-card-emphasis, #fff8e6);">
                <div class="card-body" style="display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 240px;">
                        <div style="font-weight: 600; font-size: 16px; margin-bottom: 4px;">Subscribe to Dashie</div>
                        <div style="color: var(--text-secondary); font-size: 14px; line-height: 1.5;">${bannerCopy}</div>
                    </div>
                    <button class="btn btn-primary" onclick="AccountPage.subscribe()" style="flex-shrink: 0;">
                        Subscribe
                    </button>
                </div>
            </div>
        ` : '';

        // Content is constrained to the same width as the tab divider bar (800px).
        return `
            <div style="max-width: 800px;">
                ${banner}
                ${this._renderDeletionBanner(d)}
                <div style="margin-bottom: 24px; color: var(--text-secondary); font-size: var(--font-size-sm);">
                    ${user.email} · Signed in via Google
                </div>

                <div class="stat-cards">
                    ${this._renderPlanBox(d)}
                    ${showCredits ? CreditsControls.renderBalanceCard(CreditsService.balance()) : ''}
                </div>
                ${showCredits ? CreditsControls.renderExpiryNotice(this._expiry) : ''}

                ${showCredits ? this._renderTransactions() : ''}

                <div class="section-header" style="color: var(--status-error, #c00); margin-top: 32px;">Danger Zone</div>
                <div class="card" style="border-color: var(--status-error, #c00);">
                    <div class="card-body">
                        <div style="font-weight: 500; margin-bottom: 6px;">Delete your Dashie account</div>
                        ${d.deletion_scheduled_at ? `
                        <div style="color: var(--text-secondary); font-size: var(--font-size-sm); line-height: 1.5;">
                            Your account is already scheduled for deletion — use the banner at the top of this page to keep it.
                        </div>` : `
                        <div style="color: var(--text-secondary); font-size: var(--font-size-sm); line-height: 1.5; margin-bottom: 16px;">
                            Schedules your Dashie account for deletion in 15 days. Billing stops now; your data (calendars, photos, chores, rewards, family members, OAuth tokens, voice profiles, devices) is removed when the 15 days are up. You can cancel any time before then with “Keep account.”
                        </div>
                        <button class="btn btn-danger" id="delete-account-btn" onclick="AccountPage.handleDeleteAccount()">Delete Account</button>`}
                    </div>
                </div>
            </div>
        `;
        // Manage Subscription moved to topBarActions; Sign Out moved to the
        // top-bar avatar dropdown menu (TopBar._renderMenu).
    },

    /** Single "Plan" box: tier (e.g. Core) + a renews/expires date, with a
     *  "Manage subscription" button (opens the Stripe billing portal — where you
     *  can change the plan or cancel) on the right. Replaces the separate Plan +
     *  Tier stat cards. The renewal date for an active sub comes from Stripe
     *  (current_period_end via get_transactions) since tier_expires_at is null. */
    _renderPlanBox(d) {
        const tier = this._formatTier(d.tier);
        const status = d.subscription_status;
        const date = this._subRenewsAt || d.tier_expires_at;
        const verb = status === 'trialing' ? 'trial ends'
            : status === 'canceled' ? 'expires'
            : 'renews on';
        const sub = date ? `${verb} ${this._formatDate(date)}` : '';
        const manageable = status === 'active' || status === 'trialing' || status === 'canceled';
        const manageBtn = manageable
            ? `<button class="btn btn-primary btn-sm" onclick="AccountPage.openBillingPortal()" style="flex-shrink:0;">Manage subscription</button>`
            : '';
        return `
            <div class="stat-card" style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                <div>
                    <div class="stat-card-label">Plan</div>
                    <div class="stat-card-value">${this._escape(tier)}</div>
                    ${sub ? `<div class="stat-card-detail">${this._escape(sub)}</div>` : ''}
                </div>
                ${manageBtn}
            </div>`;
    },

    /**
     * Send the user to Stripe's hosted Customer Portal where they can
     * update payment methods, cancel, view invoices, etc. Edge fn
     * `create-portal-session` verifies the user's JWT, looks up their
     * stripe_customer_id, and returns a one-time portal session URL.
     *
     * No customer on file (NO_STRIPE_CUSTOMER) → user has never been
     * through Stripe Checkout; Toast directs them to subscribe first.
     */
    async openBillingPortal() {
        const btn = document.getElementById('manage-subscription-btn');
        const restore = btn ? () => { btn.disabled = false; btn.textContent = 'Manage Subscription'; } : () => {};
        if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
        try {
            const res = await DashieAuth.edgeFunctionRequest('create-portal-session', {
                return_url: window.location.origin + window.location.pathname + '#account',
            });
            if (res?.url) {
                if (DashieAuth.isAddonMode) {
                    // Stripe's portal refuses to be framed — in HA ingress a same-frame
                    // redirect just hangs. Pop out to a new tab via a user-tap anchor.
                    ExternalLinkModal.open({
                        url: res.url,
                        title: 'Manage subscription',
                        cta: 'Open billing portal →',
                        note: 'Opens Stripe in a new tab. Manage your plan or cancel there.',
                    });
                    restore();
                } else {
                    window.location.href = res.url;
                }
                return;
            }
            throw new Error('No portal URL returned');
        } catch (e) {
            console.error('[AccountPage] openBillingPortal failed:', e);
            const msg = String(e?.message || e);
            if (msg.includes('NO_STRIPE_CUSTOMER') || msg.includes('start a checkout')) {
                Toast.info('No subscription on file yet. Start a subscription to manage billing.');
            } else {
                Toast.error(`Could not open billing portal: ${msg}`);
            }
            restore();
        }
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

    async signOut() {
        // Themed ConfirmModal — not the browser's native confirm(), which
        // renders an unstyled "<host> says" system dialog.
        const confirmed = await ConfirmModal.confirm({
            title: 'Sign out?',
            message: 'Sign out of the Dashie Console?',
            confirmLabel: 'Sign Out',
            cancelLabel: 'Cancel',
        });
        if (!confirmed) return;
        await DashieAuth.signOut();
        this._data = null;
        App._showLogin();
    },

    /**
     * Schedule account deletion (soft delete, 15-day grace). Backend
     * (`delete_account` op → handleRequestAccountDeletion) sets
     * deletion_scheduled_at = now()+15d and stops billing (cancel-at-period-end)
     * WITHOUT touching data; the purge cron hard-deletes after the grace. The
     * account stays usable during the window and the user can undo via "Keep
     * account" (cancel_account_deletion) — see _renderDeletionBanner/keepAccount.
     *
     * This console is the web-discoverable deletion path (Play Store compliance).
     * Confirmation requires typing the email — defense in depth against a misclick
     * on a shared session.
     */
    async handleDeleteAccount() {
        const email = DashieAuth.user?.email || '';
        if (!email) {
            Toast.error('Not signed in — please reload and try again.');
            return;
        }

        const confirmed = await ConfirmModal.confirm({
            title: 'Schedule account deletion?',
            message: [
                'Your account will be permanently deleted in 15 days. Until then:',
                '  • Billing stops now — no further charges',
                '  • Your data stays intact and you can cancel any time',
                '',
                'After 15 days this removes everything — calendars, photos, chores,',
                'rewards, family members, OAuth tokens, voice profiles, and devices.',
                '',
                'You can undo this with “Keep account” before the 15 days are up.',
            ].join('\n'),
            confirmLabel: 'Schedule deletion',
            cancelLabel: 'Keep My Account',
            danger: true,
            requireTypedConfirmation: email,
            typedConfirmationLabel: `Type ${email} to confirm`,
        });
        if (!confirmed) return;

        const btn = document.getElementById('delete-account-btn');
        const restore = () => { if (btn) { btn.disabled = false; btn.textContent = 'Delete Account'; } };
        if (btn) { btn.disabled = true; btn.textContent = 'Scheduling…'; }

        try {
            const result = await DashieAuth.dbRequest('delete_account', {});
            if (result?.scheduled !== true) {
                throw new Error(result?.error || 'Could not schedule deletion');
            }
            // Reflect the pending state — the restore banner takes over and the
            // account stays usable (so the user can view bills / restore). No
            // sign-out, no redirect.
            const at = result.deletion_scheduled_at || new Date(Date.now() + 15 * 86400000).toISOString();
            if (this._data) this._data.deletion_scheduled_at = at;
            const when = new Date(at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            Toast.success(`Account scheduled for deletion on ${when}. You can keep it any time before then.`);
            App.renderPage();
        } catch (err) {
            console.error('[AccountPage] handleDeleteAccount failed:', err);
            restore();
            Toast.error(`Couldn't schedule deletion: ${String(err?.message || err)}`);
        }
    },

    /** Restore banner shown at the top when the account is pending deletion.
     *  Restoring ("Keep account") is the only action — no "Delete now". */
    _renderDeletionBanner(d) {
        const at = d?.deletion_scheduled_at;
        if (!at) return '';
        const when = new Date(at);
        const days = Math.max(0, Math.ceil((when.getTime() - Date.now()) / 86400000));
        const dateStr = when.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        return `
            <div class="card" style="margin-bottom: 16px; border-left: 4px solid var(--status-error, #c00); background: var(--bg-card-emphasis, #fff8e6);">
                <div class="card-body" style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
                    <div style="flex:1; min-width:240px;">
                        <div style="font-weight:600; font-size:16px; margin-bottom:4px;">Account scheduled for deletion</div>
                        <div style="color: var(--text-secondary); font-size:14px; line-height:1.5;">
                            Your account and its data will be permanently deleted on <strong>${dateStr}</strong> (${days} day${days === 1 ? '' : 's'}). Changed your mind? You can keep it any time before then.
                        </div>
                    </div>
                    <button class="btn btn-primary" id="keep-account-btn" onclick="AccountPage.keepAccount()" style="flex-shrink:0;">Keep account</button>
                </div>
            </div>`;
    },

    /** "Keep account" — cancel the pending deletion (clears the schedule + un-cancels the sub). */
    async keepAccount() {
        const btn = document.getElementById('keep-account-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Restoring…'; }
        try {
            await DashieAuth.dbRequest('cancel_account_deletion', {});
            if (this._data) this._data.deletion_scheduled_at = null;
            Toast.success('Your account has been restored.');
            App.renderPage();
        } catch (e) {
            console.error('[AccountPage] keepAccount failed:', e);
            if (btn) { btn.disabled = false; btn.textContent = 'Keep account'; }
            Toast.error(`Couldn't restore account: ${String(e?.message || e)}`);
        }
    },
};
