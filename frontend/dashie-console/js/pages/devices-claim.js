/* ============================================================
   Devices — Claim Banner
   ------------------------------------------------------------
   Surfaces unclaimed device_installs that share a network with
   the user's already-claimed devices (the list_claimable_devices
   edge-fn guard). Lets the user link them to their account in
   bulk via claim_devices, or dismiss ones they don't own.

   Dismissals are per-browser (localStorage) — the server has no
   notion of a dismissed install, so a dismissed device would
   otherwise keep reappearing in the banner.

   Companion to devices.js — mirrors the DevicesRename banner
   pattern. Loaded as a script-tag global before devices.js.
   ============================================================ */

const DevicesClaim = {
    _claimable: null,      // raw list_claimable_devices result, or null before first fetch
    _claiming: false,      // claim_devices request in flight
    _selected: new Set(),  // install ids checked for claiming
    _dismissed: null,      // Set of install ids hidden from the banner (localStorage-backed)
    _dismissedExpanded: false,  // bottom "Dismissed" section starts collapsed

    _DISMISS_KEY: 'dashie_devices_dismissed_claims',

    _loadDismissed() {
        if (this._dismissed) return;
        try {
            this._dismissed = new Set(JSON.parse(localStorage.getItem(this._DISMISS_KEY) || '[]'));
        } catch (e) {
            this._dismissed = new Set();
        }
    },

    _saveDismissed() {
        try {
            localStorage.setItem(this._DISMISS_KEY, JSON.stringify([...this._dismissed]));
        } catch (e) { /* localStorage unavailable — dismissals just won't persist */ }
    },

    /**
     * Fetch claimable installs. Non-critical — swallows errors (like the
     * Discovered section) so a failure here never blocks the devices page.
     * The edge fn only returns installs sharing a network_id with a device
     * the caller already claimed, so an empty result is normal.
     */
    async fetch() {
        this._loadDismissed();
        try {
            const result = await DashieAuth.dbRequest('list_claimable_devices', {});
            this._claimable = result.devices || [];
            const ids = new Set(this._claimable.map(d => d.id));
            // Drop selections that are no longer claimable.
            this._selected = new Set([...this._selected].filter(id => ids.has(id)));
            // Prune dismissed ids that the server no longer reports (device
            // claimed elsewhere, went inactive, etc.) so localStorage doesn't
            // grow unbounded.
            const prunedDismissed = new Set([...this._dismissed].filter(id => ids.has(id)));
            if (prunedDismissed.size !== this._dismissed.size) {
                this._dismissed = prunedDismissed;
                this._saveDismissed();
            }
        } catch (e) {
            console.warn('[DevicesClaim] list_claimable_devices failed:', e.message);
            this._claimable = this._claimable || [];
        }
    },

    /** Claimable installs minus the ones dismissed in this browser. */
    _visible() {
        this._loadDismissed();
        return (this._claimable || []).filter(d => !this._dismissed.has(d.id));
    },

    /** Claimable installs the user dismissed — still surfaced in the
     *  collapsed Dismissed section at the bottom so they can be restored. */
    _hidden() {
        this._loadDismissed();
        return (this._claimable || []).filter(d => this._dismissed.has(d.id));
    },

    /** Display name for a claimable install. */
    _label(d) {
        const name = `${d.device_brand || ''} ${d.device_model || ''}`.trim();
        return name || d.android_id || 'Unknown device';
    },

    /** Stable signature of the visible + dismissed sets — devices.js uses
     *  this to decide whether a background refresh needs a repaint. */
    signature() {
        const vis = this._visible().map(d => d.id).sort().join(',');
        const hid = this._hidden().map(d => d.id).sort().join(',');
        return `${vis}|${hid}`;
    },

    renderBanner() {
        const devices = this._visible();
        if (devices.length === 0) return '';
        const escape = DevicesPage._escape.bind(DevicesPage);

        const rows = devices.map(d => {
            const id = escape(d.id);
            const checked = this._selected.has(d.id) ? 'checked' : '';
            const seen = d.last_checkin_at || d.installed_at;
            return `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <label style="display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer; flex: 1; min-width: 0;">
                        <input type="checkbox" ${checked} onchange="DevicesClaim.toggleSelect('${id}')">
                        <span style="font-size: 18px;">${DevicesPage._deviceIcon(d.device_type)}</span>
                        <span style="min-width: 0;">
                            <span style="font-weight: 500;">${escape(this._label(d))}</span>
                            <span style="color: var(--text-muted); font-size: var(--font-size-sm); display: block;">
                                ${escape(d.device_type || 'device')} · seen ${DevicesPage._formatTime(seen)}
                            </span>
                        </span>
                    </label>
                    <button title="Dismiss — hide this device from the banner"
                        onclick="DevicesClaim.dismiss('${id}')"
                        style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; padding: 4px 8px; line-height: 1; flex-shrink: 0;">✕</button>
                </div>
            `;
        }).join('');

        const n = this._selected.size;
        const allChecked = n === devices.length && n > 0;
        const claimLabel = this._claiming
            ? 'Adding…'
            : (n === 0 ? 'Add devices' : `Add ${n} device${n === 1 ? '' : 's'}`);

        return `
            <div class="card" style="margin-bottom: 16px; border-left: 3px solid var(--accent);">
                <div class="card-body">
                    <strong>${devices.length} device${devices.length === 1 ? '' : 's'} on your network can be added.</strong>
                    <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin: 4px 0 8px;">
                        These tablets registered themselves from Home Assistant. Link the ones
                        you own, or dismiss (✕) any you don't.
                    </div>
                    <div style="border-top: 1px solid var(--border, #d1d5db);">
                        ${rows}
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px;">
                        <button class="btn btn-secondary btn-sm" onclick="DevicesClaim.toggleSelectAll()">
                            ${allChecked ? 'Clear all' : 'Select all'}
                        </button>
                        <button class="btn btn-primary btn-sm" ${n === 0 || this._claiming ? 'disabled' : ''}
                            onclick="DevicesClaim.claimSelected()">
                            ${claimLabel}
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    toggleSelect(id) {
        if (this._selected.has(id)) this._selected.delete(id);
        else this._selected.add(id);
        App.renderPage();
    },

    toggleSelectAll() {
        const devices = this._visible();
        if (this._selected.size === devices.length) this._selected.clear();
        else this._selected = new Set(devices.map(d => d.id));
        App.renderPage();
    },

    /** Hide a claimable install from the banner (this browser only).
     *  Still surfaced in the collapsed Dismissed section at the bottom. */
    dismiss(id) {
        this._loadDismissed();
        this._dismissed.add(id);
        this._saveDismissed();
        this._selected.delete(id);
        App.renderPage();
    },

    /** Un-dismiss a claimable install — moves it back into the banner. */
    restore(id) {
        this._loadDismissed();
        this._dismissed.delete(id);
        this._saveDismissed();
        App.renderPage();
    },

    toggleDismissedExpanded() {
        this._dismissedExpanded = !this._dismissedExpanded;
        App.renderPage();
    },

    /** Collapsed section at the bottom of the Devices list — surfaces
     *  claimable installs the user dismissed, with a Restore action.
     *  Renders nothing when no dismissals exist. */
    renderDismissedSection() {
        const devices = this._hidden();
        if (devices.length === 0) return '';
        const escape = DevicesPage._escape.bind(DevicesPage);
        const caret = this._dismissedExpanded ? '▾' : '▸';

        const header = `
            <div class="section-header" style="margin-top: 32px; cursor: pointer;" onclick="DevicesClaim.toggleDismissedExpanded()">
                ${caret} Dismissed (${devices.length})
            </div>
        `;
        if (!this._dismissedExpanded) return header;

        const rows = devices.map(d => {
            const id = escape(d.id);
            const seen = d.last_checkin_at || d.installed_at;
            return `
                <div class="card" style="margin-bottom: 8px;">
                    <div class="card-body" style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                        <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
                            <div class="device-card-icon">${DevicesPage._deviceIcon(d.device_type)}</div>
                            <div style="min-width: 0;">
                                <div style="font-weight: 500;">${escape(this._label(d))}</div>
                                <div style="color: var(--text-muted); font-size: var(--font-size-sm);">
                                    ${escape(d.device_type || 'device')} · seen ${DevicesPage._formatTime(seen)}
                                </div>
                            </div>
                        </div>
                        <div style="flex-shrink: 0;">
                            <button class="btn btn-secondary btn-sm" onclick="DevicesClaim.restore('${id}')">Restore</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `${header}<div>${rows}</div>`;
    },

    async claimSelected() {
        const installIds = [...this._selected];
        if (installIds.length === 0 || this._claiming) return;
        this._claiming = true;
        App.renderPage();
        try {
            const result = await DashieAuth.dbRequest('claim_devices', { install_ids: installIds });
            const claimed = result.claimed || [];
            const rejected = result.rejected || [];

            if (claimed.length > 0) {
                Toast.success(`Added ${claimed.length} device${claimed.length === 1 ? '' : 's'}`);
            }
            if (rejected.length > 0) {
                Toast.warning(`${rejected.length} device${rejected.length === 1 ? '' : 's'} couldn't be added`);
                console.warn('[DevicesClaim] claim rejected:', rejected);
            }

            this._selected.clear();
            // Refresh claimable + the main devices list so newly-linked
            // devices show up in the Active section.
            await this.fetch();
            DevicesPage._lastListDevicesAt = 0;
            await DevicesPage._refreshSilent();
        } catch (e) {
            console.error('[DevicesClaim] claim_devices failed:', e);
            Toast.error(Toast.friendly(e, 'add these devices'));
        } finally {
            this._claiming = false;
            App.renderPage();
        }
    },
};
