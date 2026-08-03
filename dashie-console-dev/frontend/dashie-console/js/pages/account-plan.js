/* ============================================================
   AccountPlan — DELTA MODULE (Dashie builds only).
   ------------------------------------------------------------
   The Dashie plan/subscription surfaces for the Account page:
   the Plan box, the expired-subscribe banner, the Manage
   Subscription top-bar action, and the subscribe()/
   openBillingPortal() actions (attached onto AccountPage below
   because other components — top-bar menu, sidebar trial pill —
   call them by name in onclick strings).

   The open-core console ships without this file; every core call
   site reaches it via guarded `window.AccountPlan?.` / optional
   AccountPage methods and renders nothing when absent.

   Loads AFTER account.js (Object.assign target must exist).
   ============================================================ */

window.AccountPlan = {
    /** Top-bar "Manage Subscription" button. Hidden when expired — the page
     *  already has a Subscribe banner up top and the Plan box has its own CTA;
     *  a third in the header would just be noise. */
    topBarActions(data) {
        // Published build: no subscription to manage — credits are the meter.
        // (Interim guard: harmless once this file stops shipping in that build.)
        if (typeof FeatureGate !== 'undefined' && FeatureGate.isPublishedBuild()) return '';
        const expired = typeof SubscribeGate !== 'undefined' && SubscribeGate.isRequired(data);
        if (expired) return '';
        return `
            <button class="btn btn-primary" onclick="AccountPage.openBillingPortal()" id="manage-subscription-btn">
                Manage Subscription
            </button>
        `;
    },

    /** Expired-state subscribe banner card at the top of the Account page. */
    expiredBannerCard(d) {
        if (typeof FeatureGate !== 'undefined' && FeatureGate.isPublishedBuild()) return '';
        const expired = typeof SubscribeGate !== 'undefined' && SubscribeGate.isRequired(d);
        if (!expired) return '';
        const isCancel = d.subscription_status === 'canceled';
        const bannerCopy = isCancel
            ? `Your subscription has ended. Subscribe to keep using ${BRAND.productName}’s calendar, photos, family sharing, and more.`
            : `Your trial has ended. Subscribe to keep using ${BRAND.productName}’s calendar, photos, family sharing, and more.`;
        return `
            <div class="card" style="margin-bottom: 16px; border-left: 4px solid var(--accent, #ffaa00); background: var(--bg-card-emphasis, #fff8e6);">
                <div class="card-body" style="display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 240px;">
                        <div style="font-weight: 600; font-size: 16px; margin-bottom: 4px;">Subscribe to ${BRAND.productName}</div>
                        <div style="color: var(--text-secondary); font-size: 14px; line-height: 1.5;">${bannerCopy}</div>
                    </div>
                    <button class="btn btn-primary" onclick="AccountPage.subscribe()" style="flex-shrink: 0;">
                        Subscribe
                    </button>
                </div>
            </div>
        `;
    },

    /** The stat-cards section wrapping the Plan box (or '' in the published build). */
    planBoxSection(d) {
        if (typeof FeatureGate !== 'undefined' && FeatureGate.isPublishedBuild()) return '';
        return `
                <div class="stat-cards">
                    ${this._renderPlanBox(d)}
                </div>`;
    },

    /** Single "Plan" box: tier (e.g. Core) + a renews/expires date, with a
     *  "Manage subscription" button (opens the Stripe billing portal — where you
     *  can change the plan or cancel) on the right. The renewal date for an
     *  active sub comes from Stripe (current_period_end via get_transactions,
     *  stashed on AccountPage._subRenewsAt) since tier_expires_at is null. */
    _renderPlanBox(d) {
        const status = d.subscription_status;
        // ha_only (voice-only) accounts show a dedicated "HA Basic" plan name
        // rather than the raw tier ("Basic") — they intentionally have no
        // dashboard trial. No renewal date (tier_expires_at is null) and no
        // Subscribe/Manage button (canSubscribe/manageable are both false below).
        const tier = status === 'ha_only' ? 'HA Basic' : this._formatTier(d.tier);
        const date = (typeof AccountPage !== 'undefined' && AccountPage._subRenewsAt) || d.tier_expires_at;
        const verb = status === 'trialing' ? 'trial ends'
            : status === 'canceled' ? 'expires'
            : 'renews on';
        const sub = date ? `${verb} ${this._formatDate(date)}` : '';
        // A trialing (or no-subscription) user has no paid subscription to
        // manage yet — offer a proactive "Subscribe" that converts them via
        // subscribe.html, rather than "Manage subscription" (which opens an
        // empty Stripe portal). Active/canceled users still get Manage.
        const canSubscribe = status === 'trialing' || !status;
        const manageable = status === 'active' || status === 'canceled';
        const actionBtn = canSubscribe
            ? `<button class="btn btn-primary btn-sm" onclick="AccountPage.subscribe()" style="flex-shrink:0;">Subscribe</button>`
            : manageable
            ? `<button class="btn btn-primary btn-sm" onclick="AccountPage.openBillingPortal()" style="flex-shrink:0;">Manage subscription</button>`
            : '';
        return `
            <div class="stat-card" style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                <div>
                    <div class="stat-card-label">Plan</div>
                    <div class="stat-card-value">${this._escape(tier)}</div>
                    ${sub ? `<div class="stat-card-detail">${this._escape(sub)}</div>` : ''}
                </div>
                ${actionBtn}
            </div>`;
    },

    _formatTier(tier) {
        if (!tier) return 'Unknown';
        return tier.charAt(0).toUpperCase() + tier.slice(1);
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

    _escape(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
};

/* Actions other components call by name (onclick strings like
   "AccountPage.subscribe && AccountPage.subscribe()") — attached here so the
   core account.js carries no subscription code. */
Object.assign(AccountPage, {
    /** Navigate to the subscribe page. Self-auth on subscribe.html picks
     *  up identity from the active Supabase session; we also pass the
     *  user/email explicitly as belt-and-suspenders. */
    subscribe() {
        const user = DashieAuth.user || {};
        const id = encodeURIComponent(user.id || '');
        const email = encodeURIComponent(user.email || '');
        window.location.href = `/subscribe.html?user=${id}&email=${email}`;
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
});
