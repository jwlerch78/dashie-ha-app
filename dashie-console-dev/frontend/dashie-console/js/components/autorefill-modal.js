/* ============================================================
   Auto-replenish Settings Modal
   ------------------------------------------------------------
   Edits the auto-replenish rule (threshold + top-up amount) in a
   dialog instead of inline controls. The credits UI shows the
   current rule as subtext under the checkbox and opens this to
   change it. Body-attached (ConfirmModal pattern) so it works
   from any page/tab and survives App.renderPage().

   Usage:
       AutorefillModal.open({
           threshold: 1,
           topup: 10,
           onSave: (threshold, topup) => { ... },
       });
   ============================================================ */

const AutorefillModal = {
    _root: null,
    _onKeyDown: null,
    _onSave: null,

    open({ threshold, topup, onSave }) {
        this._close();
        this._onSave = onSave;
        this._render(threshold, topup);
    },

    _render(threshold, topup) {
        const amtOptions = [5, 10, 25].map(a =>
            `<option value="${a}" ${Number(topup) === a ? 'selected' : ''}>$${a}</option>`).join('');
        const root = document.createElement('div');
        root.className = 'modal-backdrop';
        root.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="ar-title" style="max-width: 440px;">
                <div class="modal-header">
                    <div class="modal-title" id="ar-title">Auto-replenish</div>
                    <button class="modal-close" data-ar="cancel" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="color: var(--text-muted); font-size:13px; margin-bottom:18px; line-height:1.5;">
                        Automatically buy more credits when your balance runs low, charged to your saved card.
                    </div>
                    <div style="display:flex; gap:18px; align-items:center; flex-wrap:wrap; font-size:14px;">
                        <label style="display:inline-flex; align-items:center; gap:6px;">When balance falls below
                            $<input id="ar-threshold" type="number" min="0" max="50" step="1" value="${Number(threshold)}"
                                style="width:60px; padding:6px 8px; border:1px solid var(--border,#e5e7eb); border-radius:6px;" /></label>
                        <label style="display:inline-flex; align-items:center; gap:6px;">add
                            <select id="ar-topup" style="padding:6px 8px; border:1px solid var(--border,#e5e7eb); border-radius:6px;">${amtOptions}</select>
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-ghost" data-ar="cancel">Cancel</button>
                    <button class="btn btn-primary" data-ar="save">Save</button>
                </div>
            </div>`;

        root.addEventListener('click', e => { if (e.target === root) this._close(); });
        root.querySelectorAll('[data-ar="cancel"]').forEach(b => b.addEventListener('click', () => this._close()));
        root.querySelector('[data-ar="save"]').addEventListener('click', () => this._save());

        this._onKeyDown = e => { if (e.key === 'Escape') { e.preventDefault(); this._close(); } };
        document.addEventListener('keydown', this._onKeyDown);

        document.body.appendChild(root);
        this._root = root;
        setTimeout(() => this._root?.querySelector('#ar-threshold')?.focus(), 30);
    },

    _save() {
        const t = Number(this._root?.querySelector('#ar-threshold')?.value);
        const u = Number(this._root?.querySelector('#ar-topup')?.value);
        const cb = this._onSave;
        this._close();
        if (cb && isFinite(t) && isFinite(u)) cb(t, u);
    },

    _close() {
        if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
        if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown);
        this._root = null;
        this._onKeyDown = null;
        this._onSave = null;
    },
};

window.AutorefillModal = AutorefillModal;
