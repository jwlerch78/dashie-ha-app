/* ============================================================
   Account & Credits Page
   ============================================================ */

const AccountPage = {
    _data: null,
    _loading: false,
    _error: null,
    _sharing: null,          // { householdSharing } — add-on mode only
    _expiry: null,           // {next_expiry:{amount,expires_at}, lots} — get_credit_expiry
    _transactions: null,     // [{kind,label,amount,unit,note,ts}] — get_transactions
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
            <button class="btn btn-secondary" onclick="AccountPage.openBillingPortal()" id="manage-subscription-btn">
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
                showCredits ? DashieAuth.dbRequest('get_transactions', { limit: 50 }).then(r => { this._transactions = r?.transactions || []; }).catch(() => {}) : Promise.resolve(),
            ]);
            this._data = response;
            // Household-sharing opt-in lives in the add-on only; fetch it so the
            // toggle reflects the persisted state. Best-effort (non-fatal).
            if (DashieAuth.isAddonMode) {
                try {
                    const s = await fetch(DashieAuth._addonUrl('/api/settings')).then(r => r.ok ? r.json() : null);
                    this._sharing = s || { householdSharing: false };
                } catch (e) {
                    this._sharing = { householdSharing: false };
                }
            }
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

    /** Household Dashie Cloud sharing toggle — add-on mode only. Controls whether
     *  un-logged-in tablets / voice satellites on this network may use this
     *  account's cloud voice (billed to its credits). See add-on settings-store. */
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
                            onclick="AccountPage.toggleHouseholdSharing(${!enabled})" style="flex-shrink:0;">
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
            console.error('[AccountPage] Toggle household sharing failed:', e);
            alert('Could not update sharing setting: ' + e.message);
        }
    },

    _renderLoaded() {
        const user = DashieAuth.user;
        const d = this._data || {};

        // Subscription display
        const statusDisplay = this._formatStatus(d.subscription_status, d.tier_expires_at);

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

        return `
            ${banner}
            <div style="margin-bottom: 24px; color: var(--text-secondary); font-size: var(--font-size-sm);">
                ${user.email} · Signed in via Google
            </div>

            <div class="stat-cards" style="align-items: start;">
                ${Card.stat('Plan', statusDisplay.label, statusDisplay.detail)}
                ${Card.stat('Tier', this._formatTier(d.tier), d.has_voice_license ? 'Voice license active' : '')}
                ${showCredits ? CreditsControls.renderBalanceCard(CreditsService.balance()) : ''}
            </div>
            ${showCredits ? CreditsControls.renderExpiryNotice(this._expiry) : ''}

            ${showCredits ? this._renderTransactions() : ''}

            ${this._renderHouseholdSharing()}

            <div class="section-header" style="color: var(--status-error, #c00); margin-top: 32px;">Danger Zone</div>
            <div class="card" style="border-color: var(--status-error, #c00);">
                <div class="card-body">
                    <div style="font-weight: 500; margin-bottom: 6px;">Delete your Dashie account</div>
                    <div style="color: var(--text-secondary); font-size: var(--font-size-sm); line-height: 1.5; margin-bottom: 16px;">
                        Permanently removes your Dashie account and everything associated with it — calendars, photos, chores, rewards, family members, OAuth tokens, voice profiles, and device registrations. This cannot be undone.
                    </div>
                    <button class="btn btn-danger" id="delete-account-btn" onclick="AccountPage.handleDeleteAccount()">Delete Account</button>
                </div>
            </div>

        `;
        // Manage Subscription moved to topBarActions; Sign Out moved to the
        // top-bar avatar dropdown menu (TopBar._renderMenu).
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
                window.location.href = res.url;
                return;  // navigation in progress; don't restore button
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
     * Permanently delete the Dashie account. Backend (`delete_account` op in
     * database-operations) wipes every user-scoped table, the photos +
     * wake-word-samples storage buckets, and finally the auth.users row.
     *
     * Required for Google Play Store compliance — apps with in-app account
     * creation must offer a web-discoverable deletion path. See B.6 in
     * .reference/build-plans/20260415_DASHIE_HA_ADDON_W_TOKEN_MGMT.md.
     *
     * Confirmation requires the user to type their email — defense in depth
     * against a misclick by someone who walked away from a signed-in session.
     * Backend only returns `deleted: true` when every step succeeded; partial
     * failures leave the account intact and surface a Toast for retry.
     */
    async handleDeleteAccount() {
        const email = DashieAuth.user?.email || '';
        if (!email) {
            Toast.error('Not signed in — please reload and try again.');
            return;
        }

        const confirmed = await ConfirmModal.confirm({
            title: 'Delete your Dashie account?',
            message: [
                'This permanently deletes:',
                '  • Your subscription and account history',
                '  • Family members and all their assignments',
                '  • Calendars, calendar accounts, and OAuth tokens',
                '  • Chores, rewards, and points history',
                '  • Photos in your Dashie Cloud library',
                '  • Voice profiles and AI personalities',
                '  • All registered devices and their settings',
                '',
                'You will be signed out everywhere. This cannot be undone.',
            ].join('\n'),
            confirmLabel: 'Delete Forever',
            cancelLabel: 'Keep My Account',
            danger: true,
            requireTypedConfirmation: email,
            typedConfirmationLabel: `Type ${email} to confirm`,
        });
        if (!confirmed) return;

        const btn = document.getElementById('delete-account-btn');
        const restore = () => {
            if (btn) { btn.disabled = false; btn.textContent = 'Delete Account'; }
        };
        if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }

        try {
            const result = await DashieAuth.dbRequest('delete_account', {});

            // The edge fn returns { deleted: false, errors: [...] } on partial
            // failure. Only treat exact `deleted: true` as success — anything
            // else means the account is in a possibly-half-cleaned state and
            // we should surface for retry rather than redirect.
            if (result?.deleted !== true) {
                const detail = result?.errors?.[0]?.error
                    || result?.error
                    || 'Deletion did not complete';
                throw new Error(detail);
            }

            // Clean up every browser-side trace before navigating away —
            // localStorage holds JWTs, family-member info, IndexedDB caches
            // may hold tokens. A reload-without-cleanup would let the
            // half-orphaned session linger.
            try { localStorage.clear(); } catch (_) {}
            try { sessionStorage.clear(); } catch (_) {}

            // Best-effort: nuke common Console-side IDB stores if they exist.
            // Failure is fine — they're stale and won't cause harm.
            try {
                if (window.indexedDB?.databases) {
                    const dbs = await window.indexedDB.databases();
                    for (const db of (dbs || [])) {
                        if (db?.name) window.indexedDB.deleteDatabase(db.name);
                    }
                }
            } catch (_) {}

            // signOut clears DashieAuth's in-memory state + any subscriptions.
            try { DashieAuth.signOut?.(); } catch (_) {}

            // Redirect to the goodbye state — login page reads ?deleted=1
            // and shows a one-time toast on the next load.
            window.location.replace(window.location.origin + window.location.pathname + '?deleted=1');
        } catch (err) {
            console.error('[AccountPage] handleDeleteAccount failed:', err);
            const msg = String(err?.message || err);
            Toast.error(`Failed to delete account: ${msg}. Please try again or contact support.`);
            restore();
        }
    },
};
