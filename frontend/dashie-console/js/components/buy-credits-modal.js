/* ============================================================
   Buy Credits Modal
   ------------------------------------------------------------
   Amount picker for a one-time credit purchase ($5 / $10 / $25).
   Body-attached (modeled on ConfirmModal) so it survives an
   App.renderPage() and works opened from any page/tab.

   Checkout has two modes, decided here:
     - Standalone browser: navigate the page to Stripe (today's flow).
     - HA ingress iframe: Stripe refuses to be framed, so we render
       a user-clickable "Continue to checkout" anchor (target=_blank)
       — mirroring the device-flow login pop-out — and POLL the
       balance until the webhook grants, then show success in-place.

   Usage:
       BuyCreditsModal.open({
           packs: [{usd, price_id}, ...],
           getCheckoutUrl: async (priceId) => '<stripe url>',  // CreditsControls.buyCredits
       });
   ============================================================ */

const BuyCreditsModal = {
    _root: null,
    _onKeyDown: null,
    _pollTimer: null,
    _pollDeadline: 0,
    _getCheckoutUrl: null,

    open({ packs, getCheckoutUrl }) {
        this._closeImmediate();   // collapse any prior instance
        this._getCheckoutUrl = getCheckoutUrl;
        this._render(packs || []);
    },

    _render(packs) {
        const buttons = packs.map(p => `
            <button class="btn btn-secondary" data-bc-price="${this._escape(p.price_id)}"
                style="flex:1; min-width:80px; font-weight:600; padding:14px 0; font-size:15px;">
                $${p.usd}
            </button>`).join('');

        const root = document.createElement('div');
        root.className = 'modal-backdrop';
        root.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="bc-title" style="max-width: 440px;">
                <div class="modal-header">
                    <div class="modal-title" id="bc-title">Buy credits</div>
                    <button class="modal-close" data-bc="cancel" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body" data-bc-body>
                    <div style="display:flex; gap:10px;">${buttons}</div>
                    <div style="color: var(--text-muted); font-size:11px; margin-top:10px;">1 credit = $1 USD · credits expire 1 year after purchase.</div>
                </div>
            </div>`;

        root.addEventListener('click', e => { if (e.target === root) this._cancel(); });
        root.querySelector('[data-bc="cancel"]').addEventListener('click', () => this._cancel());
        root.querySelectorAll('[data-bc-price]').forEach(btn => {
            btn.addEventListener('click', () => this._pick(btn.getAttribute('data-bc-price')));
        });

        this._onKeyDown = e => { if (e.key === 'Escape') { e.preventDefault(); this._cancel(); } };
        document.addEventListener('keydown', this._onKeyDown);

        document.body.appendChild(root);
        this._root = root;
    },

    async _pick(priceId) {
        const body = this._root?.querySelector('[data-bc-body]');
        this._root?.querySelectorAll('[data-bc-price]').forEach(b => { b.disabled = true; });
        if (body) body.style.opacity = '0.6';

        let url;
        try {
            url = await this._getCheckoutUrl(priceId);
        } catch (e) {
            if (body) body.style.opacity = '';
            this._root?.querySelectorAll('[data-bc-price]').forEach(b => { b.disabled = false; });
            if (window.Toast) Toast.error('Checkout failed: ' + (e?.message || e));
            return;
        }

        // Standalone browser: full-page redirect to Stripe (return via ?credits=success).
        if (!window.DashieAuth?.isAddonMode) { window.location = url; return; }

        // HA ingress: pop out to a new tab + poll for the granted balance.
        const cur = window.CreditsService?.balance?.();
        const startBal = (cur && typeof cur.balance === 'number') ? cur.balance : 0;
        this._renderWaiting(url);
        this._startPolling(startBal);
    },

    _renderWaiting(url) {
        const body = this._root?.querySelector('[data-bc-body]');
        if (!body) return;
        body.style.opacity = '';
        body.innerHTML = `
            <a href="${this._escape(url)}" target="_blank" rel="noopener" class="btn btn-primary"
               style="display:flex; align-items:center; justify-content:center; text-decoration:none; padding:14px 0; font-weight:600;">
                Continue to secure checkout &rarr;
            </a>
            <div style="color: var(--text-muted); font-size:12px; margin-top:12px; line-height:1.5;">
                Opens Stripe in a new tab. Complete your payment there — this window updates automatically once your credits arrive.
            </div>
            <div style="display:flex; align-items:center; gap:10px; margin-top:16px; color: var(--text-muted); font-size:13px;">
                <div style="width:16px; height:16px; border:2px solid var(--border,#e5e7eb); border-top-color: var(--accent); border-radius:50%; animation: bcspin 0.8s linear infinite;"></div>
                Waiting for payment…
            </div>
            <div style="margin-top:16px;">
                <button class="btn btn-ghost btn-sm" data-bc="cancel">Cancel</button>
            </div>
            <style>@keyframes bcspin { to { transform: rotate(360deg); } }</style>`;
        body.querySelector('[data-bc="cancel"]')?.addEventListener('click', () => this._cancel());
    },

    _startPolling(startBal) {
        this._stopPolling();
        this._pollDeadline = Date.now() + 5 * 60 * 1000;   // give up after 5 min
        const tick = async () => {
            if (Date.now() > this._pollDeadline) { this._stopPolling(); return; }
            let bal = null;
            try {
                const r = await window.CreditsService?.fetch?.({ force: true });
                if (r && typeof r.balance === 'number') bal = r.balance;
            } catch (_) { /* keep polling */ }
            if (bal !== null && bal > startBal + 0.0001) { this._success(); return; }
            this._pollTimer = setTimeout(tick, 3000);
        };
        this._pollTimer = setTimeout(tick, 3000);
    },

    _stopPolling() {
        if (this._pollTimer) clearTimeout(this._pollTimer);
        this._pollTimer = null;
    },

    _success() {
        this._stopPolling();
        const body = this._root?.querySelector('[data-bc-body]');
        if (body) {
            body.innerHTML = `
                <div style="text-align:center; padding:8px 0;">
                    <div style="font-size:32px;">✅</div>
                    <div style="font-weight:600; margin-top:8px;">Credits added</div>
                    <div style="color: var(--text-muted); font-size:13px; margin-top:4px;">Your new balance is ready.</div>
                    <button class="btn btn-primary btn-sm" data-bc="done" style="margin-top:16px;">Done</button>
                </div>`;
            body.querySelector('[data-bc="done"]')?.addEventListener('click', () => {
                this._closeImmediate();
                window.App?.renderPage?.();
            });
        }
        // Refresh the page behind the modal so its balance/stat cards update too.
        window.App?.renderPage?.();
    },

    _cancel() { this._closeImmediate(); },

    _closeImmediate() {
        this._stopPolling();
        if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
        if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown);
        this._root = null;
        this._onKeyDown = null;
        this._getCheckoutUrl = null;
    },

    _escape(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
};

window.BuyCreditsModal = BuyCreditsModal;
