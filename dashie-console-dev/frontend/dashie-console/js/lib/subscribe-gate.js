/* ============================================================
   SubscribeGate
   ------------------------------------------------------------
   Centralized subscribe-prompt logic. After auth resolves on the
   Console, this checks the user's subscription state and shows a
   Subscribe prompt modal if no current entitlement exists.

   The gate is the single canonical entry point to the web subscribe
   flow — see .reference/build-plans/20260520_WEB_EMAIL_SUBSCRIPTION_FLOW.md.
   Email links, marketing-site CTAs, and the Amazon device's
   "subscribe at app.dashieapp.com/console" message all route users
   here; the gate fires automatically because expired state triggers
   the prompt.

   Loaded as a script-tag global before app.js.

   DELTA MODULE: attached to window so core callers (app.js, top-bar,
   sidebar) can reach it via guarded `window.SubscribeGate?.` — the
   open-core console ships without this file and those call sites no-op.
   ============================================================ */

window.SubscribeGate = {
    _shownThisSession: false,
    _checking: false,

    /**
     * Pure predicate: should the subscribe prompt fire for this user?
     *
     * Triggers when there's no current entitlement:
     *   - trial_expired
     *   - canceled past tier_expires_at
     *
     * Does NOT trigger for:
     *   - trialing / active / complimentary (still entitled)
     *   - canceled within grace (still entitled until tier_expires_at)
     *   - past_due (separate UX — direct to Stripe portal to fix card)
     *
     * @param {object} data — check-subscription response
     * @returns {boolean}
     */
    isRequired(data) {
        if (!data) return false;
        const status = data.subscription_status;
        if (!status) return false;
        if (status === 'trial_expired') return true;
        if (status === 'canceled') {
            const exp = data.tier_expires_at ? new Date(data.tier_expires_at).getTime() : 0;
            return exp > 0 && exp < Date.now();
        }
        return false;
    },

    /**
     * Check subscription state and show the prompt if required.
     * Idempotent within a session — won't re-show after dismiss.
     * Non-blocking — caller doesn't need to await.
     */
    async checkAndShow() {
        // Published build: no family plan/trial — never prompt, never push
        // entitlement state (credits are enforced server-side per call).
        if (typeof FeatureGate !== 'undefined' && FeatureGate.isPublishedBuild()) return;
        if (this._shownThisSession || this._checking) return;
        if (typeof DashieAuth === 'undefined' || !DashieAuth.isAuthenticated || !DashieAuth.user?.id) return;

        this._checking = true;
        try {
            const data = await DashieAuth.edgeFunctionRequest('check-subscription', {
                auth_user_id: DashieAuth.user.id,
            });
            // Push state into FeatureGate so the sidebar hides cloud
            // features (Calendar, Family, Photos, etc.) when expired.
            // This triggers a re-render via FeatureGate.setSubscriptionState.
            if (typeof FeatureGate !== 'undefined') FeatureGate.setSubscriptionState(data);
            if (this.isRequired(data)) {
                this._shownThisSession = true;
                // Users with no console value get the full-page purchase landing
                // (App._renderExpiredLanding) — don't stack this modal on top.
                // Everyone else gets a one-time nudge; the persistent global
                // banner keeps the CTA visible after dismiss.
                if (data.has_console_value !== false) this.showPrompt(data);
            }
        } catch (e) {
            console.warn('[SubscribeGate] check-subscription failed:', e?.message || e);
            // Fail-open: if the check fails, we don't show the prompt.
            // Better to miss a nudge than to interrupt every sign-in on
            // a network blip.
        } finally {
            this._checking = false;
        }
    },

    /**
     * Render the subscribe-prompt modal. Dismissable — Console is also
     * the cancel / delete-account surface, so users can close and still
     * reach Account → Manage / Delete.
     */
    showPrompt(data) {
        // Tear down any existing instance (defensive — checkAndShow guards
        // against double-fire, but reload-via-hash could re-enter).
        const existing = document.querySelector('.subscribe-prompt-root');
        if (existing) existing.remove();

        const root = document.createElement('div');
        root.className = 'subscribe-prompt-root';
        root.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 16px;';

        const isCancel = data?.subscription_status === 'canceled';
        const title = isCancel ? `Your ${BRAND.productName} subscription has ended` : `Your ${BRAND.productName} trial has ended`;

        root.innerHTML = `
            <div role="dialog" aria-modal="true" aria-labelledby="subscribe-prompt-title"
                 style="background: var(--bg-card, #fff); border-radius: 12px; max-width: 460px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); padding: 24px; position: relative;">
                <button data-action="dismiss" aria-label="Close"
                        style="position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 20px; color: var(--text-muted); cursor: pointer; padding: 4px 8px; line-height: 1;">✕</button>
                <h2 id="subscribe-prompt-title" style="margin: 0 0 12px 0; font-size: 19px;">${title}</h2>
                <div style="color: var(--text-secondary); font-size: 14px; line-height: 1.5; margin-bottom: 20px;">
                    Subscribe to keep using ${BRAND.productName}:
                    <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                        <li>Calendar sync across Google, Apple, Microsoft</li>
                        <li>Photo library + slideshows on every screen</li>
                        <li>Chores, rewards, and family sharing</li>
                        <li>All your registered ${BRAND.productName} devices</li>
                    </ul>
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button class="btn btn-ghost" data-action="dismiss">Not now</button>
                    <button class="btn btn-primary" data-action="subscribe">Subscribe to ${BRAND.productName}</button>
                </div>
            </div>
        `;

        // Backdrop click dismisses (only on the root, not when clicking inside the dialog)
        root.addEventListener('click', (e) => {
            if (e.target === root) this._dismiss(root);
        });
        root.querySelectorAll('[data-action="dismiss"]').forEach(el => {
            el.addEventListener('click', () => this._dismiss(root));
        });
        root.querySelector('[data-action="subscribe"]').addEventListener('click', () => {
            this._goToSubscribe();
        });

        // Escape key dismisses
        this._escHandler = (e) => {
            if (e.key === 'Escape') this._dismiss(root);
        };
        document.addEventListener('keydown', this._escHandler);

        document.body.appendChild(root);
    },

    _dismiss(root) {
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
        if (root && root.parentNode) root.parentNode.removeChild(root);
    },

    /** Pass user identity explicitly — defense in depth against subscribe.html
     *  self-auth missing edge cases. The page also accepts a fall back to the
     *  Supabase session for callers that can't pass identity (email links). */
    _goToSubscribe() {
        const user = DashieAuth.user || {};
        const id = encodeURIComponent(user.id || '');
        const email = encodeURIComponent(user.email || '');
        window.location.href = `/subscribe.html?user=${id}&email=${email}`;
    },

    /* ---- Core-UI fragments (called guarded from core components) ---- */

    /** Purchase-intent login copy: when subscribe.html bounced the buyer here
     *  to sign in (see App._captureNextParam), tailor the login card so it's
     *  clear WHICH Google account to use. Returns null when there's no
     *  purchase intent. Called (guarded) from App._showLogin. */
    loginPurchaseCopy() {
        let intent = false;
        try {
            const n = sessionStorage.getItem(App._NEXT_STORAGE_KEY);
            intent = !!n && n.indexOf('subscribe.html') !== -1;
        } catch (_) {}
        if (!intent) return null;
        return {
            title: `Purchase a ${BRAND.productName} license`,
            subtitle: 'Sign in to the Google account you wish to purchase a license for.',
            googleDesc: "The account you'll buy the license for",
        };
    },

    /** "Purchase License" entry in the sidebar's Dashie Cloud section, shown
     *  only when the trial/subscription has expired (no entitlement) — a
     *  direct sidebar path to buy. Called (guarded) from Sidebar._purchaseNavItem. */
    renderPurchaseNavItem() {
        if (typeof FeatureGate === 'undefined' || FeatureGate.hasEntitlement()) return '';
        return `
            <div class="sidebar-nav-item" onclick="AccountPage.subscribe && AccountPage.subscribe()">
                <span class="nav-icon"><img src="assets/icons/icon-star.svg" alt="Purchase License"></span>
                <span class="nav-label">Purchase License</span>
            </div>
        `;
    },

    /** Subscribe entry (plus divider) for the top-bar avatar menu. Shown when
     *  the user has no current entitlement — FeatureGate.hasEntitlement() is
     *  optimistic-true until state loads, so this only appears for
     *  confirmed-expired users. Called (guarded) from TopBar._renderMenu. */
    renderMenuSubscribeRow() {
        const show = typeof FeatureGate !== 'undefined' && !FeatureGate.hasEntitlement();
        if (!show) return '';
        return `
                <button onclick="TopBar.closeMenu(); AccountPage.subscribe && AccountPage.subscribe()"
                        style="width: 100%; text-align: left; padding: 10px 14px; background: none;
                               border: none; cursor: pointer; font-size: 14px; color: var(--accent, #ffaa00); font-weight: 600;">
                    Subscribe to ${BRAND.productName}
                </button>
                <div style="height: 1px; background: var(--border, #e5e7eb);"></div>`;
    },

    /** Persistent "trial/subscription ended" banner for expired users who keep
     *  console access (device/HA management). Dismissable for the session via
     *  App._dismissExpiredBanner (the flag lives on App so it survives this
     *  module's absence in open-core builds). Called (guarded) from
     *  App._expiredBannerHtml. */
    expiredBannerHtml() {
        if (typeof FeatureGate === 'undefined' || FeatureGate.hasEntitlement()) return '';
        if (typeof App !== 'undefined' && App._expiredBannerDismissed) return '';
        const st = FeatureGate._subscriptionState || {};
        const canceled = st.subscription_status === 'canceled';
        const msg = canceled ? `Your ${BRAND.productName} subscription has ended.` : `Your ${BRAND.productName} trial has ended.`;
        return `
            <div style="background: var(--accent, #ffaa00); color:#fff; padding:10px 16px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                <div style="font-size:14px; font-weight:500;">${msg} Subscribe to restore calendar, photos, family &amp; more.</div>
                <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                    <button class="btn btn-sm" style="background:#fff; color:var(--accent,#ffaa00); font-weight:700; border:none;"
                            onclick="SubscribeGate._goToSubscribe()">Subscribe</button>
                    <button aria-label="Dismiss" title="Dismiss"
                            style="background:none; border:none; color:#fff; font-size:18px; line-height:1; cursor:pointer; padding:4px 6px; opacity:0.9;"
                            onclick="App._dismissExpiredBanner()">&times;</button>
                </div>
            </div>`;
    },

    /** Full-content purchase landing for expired users with no console value.
     *  Reuses the login-overlay/card styling; keeps the top-bar so Sign out /
     *  Delete account remain reachable. Called (guarded) from
     *  App._renderExpiredLanding. */
    renderExpiredLanding() {
        const sb = document.getElementById('sidebar');
        if (sb) { sb.innerHTML = ''; sb.style.display = 'none'; }
        const tb = document.getElementById('top-bar');
        if (tb) tb.innerHTML = TopBar.render('Subscribe', '', false);
        const _gb = document.getElementById('global-banner');
        if (_gb) _gb.innerHTML = '';

        const st = (typeof FeatureGate !== 'undefined' && FeatureGate._subscriptionState) || {};
        const canceled = st.subscription_status === 'canceled';
        const heading = canceled ? `Your ${BRAND.productName} subscription has ended` : `Your ${BRAND.productName} trial has ended`;
        const content = document.getElementById('content');
        if (!content) return;
        content.innerHTML = `
            <div class="dashie-login-overlay">
                <div class="dashie-login-card" style="max-width: 460px;">
                    <img src="${BRAND.logo}" alt="${BRAND.productName}" class="dashie-login-logo">
                    <div class="dashie-login-title">${heading}</div>
                    <div class="dashie-login-subtitle">Subscribe to unlock the full ${BRAND.productName} experience:</div>
                    <ul style="text-align:left; color: var(--text-secondary, #555); font-size:14px; line-height:1.7; margin: 4px auto 20px; max-width: 320px;">
                        <li>Calendar sync across Google, Apple, Microsoft</li>
                        <li>Photo library + slideshows on every screen</li>
                        <li>Chores, rewards, and family sharing</li>
                        <li>All your registered ${BRAND.productName} devices</li>
                    </ul>
                    <div class="dashie-login-buttons">
                        <button class="btn btn-primary" style="width:100%;" onclick="SubscribeGate._goToSubscribe()">Subscribe to ${BRAND.productName}</button>
                        <button class="btn btn-ghost btn-sm" style="margin-top:10px;" onclick="AccountPage.signOut()">Sign out</button>
                    </div>
                </div>
            </div>`;
    },
};
