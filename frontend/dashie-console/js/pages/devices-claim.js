/* ============================================================
   Devices — Unified "Available to Add" Banner
   ------------------------------------------------------------
   Surfaces every device the user can add to their account, regardless
   of how the backend knows about it:

   - **install** kind — `device_installs` rows on the same network as
     a device the user already claimed (from list_claimable_devices).
     Claimed via the bulk `claim_devices` edge fn.
   - **discovered** kind — devices HA reports state for but which never
     called register_device (kiosk-mode tablets — no install row, no
     sign-in). Added via the add-on's POST /api/ha/adopt/:deviceId,
     which calls adopt_device_from_ha on the backend.

   The UI is identical for both — same row, same Add button, same
   Dismiss ✕. Routing happens inside claimSelected() based on each
   row's `kind`. Users don't need to know the difference.

   Dismissals are per-browser (localStorage). Both kinds dismiss into
   the same collapsed "Dismissed" section at the bottom.
   ============================================================ */

const DevicesClaim = {
    _claimable: null,              // raw list_claimable_devices result
    _claiming: false,              // request in flight (claim or adopt)
    _selected: new Set(),          // uids currently checked
    _dismissed: null,              // Set of dismissed uids (localStorage)
    _dismissedExpanded: false,     // collapsed Dismissed section state

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
        } catch (e) { /* localStorage unavailable */ }
    },

    /**
     * Refresh the claimable installs list. Discovered devices come from
     * DevicesPage._discoveredDevices() (which reads the worker's status
     * — no separate fetch needed). Non-critical — swallows errors so a
     * failure here doesn't block the devices page.
     */
    async fetch() {
        this._loadDismissed();
        try {
            const result = await DashieAuth.dbRequest('list_claimable_devices', {});
            this._claimable = result.devices || [];
            const uids = new Set(this._addable().map(a => a.uid));
            // Drop selections that are no longer addable.
            this._selected = new Set([...this._selected].filter(uid => uids.has(uid)));
            // NOTE: do NOT prune _dismissed here. _addable() pulls discovered
            // rows from DevicesPage._discoveredDevices(), which can be empty
            // on first fetch (worker not warm). Pruning then would silently
            // forget dismissals for discovered devices, and they'd reappear
            // in the banner once the worker reports them. _visible()/_hidden()
            // already filter through _addable() before rendering, so stale
            // UIDs in the Set are harmless.
        } catch (e) {
            console.warn('[DevicesClaim] list_claimable_devices failed:', e.message);
            this._claimable = this._claimable || [];
        }
    },

    /**
     * Merge installs + discovered into a single unified shape. Both kinds
     * render through the same banner row markup.
     *
     * Unified row:
     *   { uid, kind, name, deviceType, lastSeen, installId?, haDeviceId? }
     */
    _addable() {
        const list = [];
        // install rows from list_claimable_devices
        for (const d of (this._claimable || [])) {
            let name = `${d.device_brand || ''} ${d.device_model || ''}`.trim() || d.android_id || 'Unknown device';
            // Tag non-prod debug builds so a dev's fleet (same physical
            // tablet running multiple flavors) is visually distinguishable.
            // Real end users only ever install one flavor, so they see no tag.
            if (d.build_flavor === 'staging') name += ' -dev';
            else if (d.build_flavor === 'local') name += ' -loc';
            list.push({
                uid: d.id,                // install_id UUID
                kind: 'install',
                name,
                deviceType: d.device_type || 'device',
                lastSeen: d.last_checkin_at || d.installed_at,
                installId: d.id,
                haDeviceId: null,
            });
        }
        // discovered devices from the add-on worker's unmatched array
        const discovered = (typeof DevicesPage !== 'undefined' && DevicesPage._discoveredDevices)
            ? DevicesPage._discoveredDevices() : [];
        for (const d of discovered) {
            if (!d.device_id) continue;   // need device_id to call /api/ha/adopt
            // De-dup vs install rows in case both surfaces report the
            // same hardware. android_id == device_id in our schema, so we
            // can match an install row to a discovered device by that.
            const installRow = (this._claimable || []).find(c => c.android_id === d.device_id);
            if (installRow) continue;     // already represented by the install entry
            list.push({
                uid: 'ha:' + d.device_id,
                kind: 'discovered',
                name: d.device_name || `Device ${d.device_id.slice(0, 8)}`,
                deviceType: 'device',     // discovered payload doesn't have type
                lastSeen: null,           // worker doesn't surface a last-seen for unmatched
                installId: null,
                haDeviceId: d.device_id,
            });
        }
        return list;
    },

    /** Addables not yet dismissed. */
    _visible() {
        this._loadDismissed();
        return this._addable().filter(a => !this._dismissed.has(a.uid));
    },

    /** Addables the user dismissed. */
    _hidden() {
        this._loadDismissed();
        return this._addable().filter(a => this._dismissed.has(a.uid));
    },

    /** Stable signature — devices.js uses it to skip silent-refresh repaints. */
    signature() {
        const vis = this._visible().map(a => a.uid).sort().join(',');
        const hid = this._hidden().map(a => a.uid).sort().join(',');
        return `${vis}|${hid}`;
    },

    renderBanner() {
        const items = this._visible();
        if (items.length === 0) return '';
        const escape = DevicesPage._escape.bind(DevicesPage);

        const rows = items.map(a => {
            const uid = escape(a.uid);
            const checked = this._selected.has(a.uid) ? 'checked' : '';
            const seenText = a.lastSeen
                ? `seen ${DevicesPage._formatTime(a.lastSeen)}`
                : 'reported by Home Assistant';
            return `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <label style="display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer; flex: 1; min-width: 0;">
                        <input type="checkbox" ${checked} onchange="DevicesClaim.toggleSelect('${uid}')">
                        <span style="font-size: 18px;">${DevicesPage._deviceIcon(a.deviceType)}</span>
                        <span style="min-width: 0;">
                            <span style="font-weight: 500;">${escape(a.name)}</span>
                            <span style="color: var(--text-muted); font-size: var(--font-size-sm); display: block;">
                                ${escape(a.deviceType)} · ${seenText}
                            </span>
                        </span>
                    </label>
                    <button title="Dismiss — hide this device from the banner"
                        onclick="DevicesClaim.dismiss('${uid}')"
                        style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; padding: 4px 8px; line-height: 1; flex-shrink: 0;">✕</button>
                </div>
            `;
        }).join('');

        const n = this._selected.size;
        const allChecked = n === items.length && n > 0;
        const addLabel = this._claiming
            ? 'Adding…'
            : (n === 0 ? 'Add devices' : `Add ${n} device${n === 1 ? '' : 's'}`);

        return `
            <div class="card" style="margin-bottom: 16px; border-left: 3px solid var(--accent);">
                <div class="card-body">
                    <strong>${items.length} device${items.length === 1 ? '' : 's'} can be added to your account.</strong>
                    <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin: 4px 0 8px;">
                        Select the ones you own, or dismiss (✕) any you don't.
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
                            ${addLabel}
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    toggleSelect(uid) {
        if (this._selected.has(uid)) this._selected.delete(uid);
        else this._selected.add(uid);
        App.renderPage();
    },

    toggleSelectAll() {
        const items = this._visible();
        if (this._selected.size === items.length) this._selected.clear();
        else this._selected = new Set(items.map(a => a.uid));
        App.renderPage();
    },

    /** Hide a row from the banner (this browser only). Still surfaces in
     *  the collapsed Dismissed section so the user can Restore later. */
    dismiss(uid) {
        this._loadDismissed();
        this._dismissed.add(uid);
        this._saveDismissed();
        this._selected.delete(uid);
        App.renderPage();
    },

    /** Un-dismiss a row — moves back into the banner. */
    restore(uid) {
        this._loadDismissed();
        this._dismissed.delete(uid);
        this._saveDismissed();
        App.renderPage();
    },

    toggleDismissedExpanded() {
        this._dismissedExpanded = !this._dismissedExpanded;
        App.renderPage();
    },

    /** Collapsed Dismissed section at the bottom of the Devices page. */
    renderDismissedSection() {
        const items = this._hidden();
        if (items.length === 0) return '';
        const escape = DevicesPage._escape.bind(DevicesPage);
        const caret = this._dismissedExpanded ? '▾' : '▸';

        const header = `
            <div class="section-header" style="margin-top: 32px; cursor: pointer;" onclick="DevicesClaim.toggleDismissedExpanded()">
                ${caret} Dismissed (${items.length})
            </div>
        `;
        if (!this._dismissedExpanded) return header;

        const rows = items.map(a => {
            const uid = escape(a.uid);
            const seenText = a.lastSeen
                ? `seen ${DevicesPage._formatTime(a.lastSeen)}`
                : 'reported by Home Assistant';
            return `
                <div class="card" style="margin-bottom: 8px;">
                    <div class="card-body" style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                        <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
                            <div class="device-card-icon">${DevicesPage._deviceIcon(a.deviceType)}</div>
                            <div style="min-width: 0;">
                                <div style="font-weight: 500;">${escape(a.name)}</div>
                                <div style="color: var(--text-muted); font-size: var(--font-size-sm);">
                                    ${escape(a.deviceType)} · ${seenText}
                                </div>
                            </div>
                        </div>
                        <div style="flex-shrink: 0;">
                            <button class="btn btn-secondary btn-sm" onclick="DevicesClaim.restore('${uid}')">Restore</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `${header}<div>${rows}</div>`;
    },

    /**
     * Add the selected rows. Groups by kind and dispatches:
     *   - install rows → bulk claim_devices(install_ids)
     *   - discovered rows → parallel POST /api/ha/adopt/:deviceId per row
     * Aggregates success/failure counts into a single toast.
     */
    async claimSelected() {
        if (this._selected.size === 0 || this._claiming) return;
        this._claiming = true;
        App.renderPage();

        const items = this._addable().filter(a => this._selected.has(a.uid));
        const installs   = items.filter(a => a.kind === 'install');
        const discovered = items.filter(a => a.kind === 'discovered');

        let added = 0;
        const failures = [];

        try {
            // Bulk claim path
            if (installs.length > 0) {
                try {
                    const result = await DashieAuth.dbRequest('claim_devices', {
                        install_ids: installs.map(a => a.installId),
                    });
                    added += (result.claimed || []).length;
                    for (const r of (result.rejected || [])) {
                        const item = installs.find(a => a.installId === r.id);
                        failures.push({ name: item?.name || '(unknown)', reason: r.reason });
                    }
                } catch (e) {
                    console.error('[DevicesClaim] claim_devices failed:', e);
                    for (const a of installs) failures.push({ name: a.name, reason: e.message || 'claim failed' });
                }
            }

            // Per-device adopt path (parallel — typically only 1-3 kiosk devices)
            if (discovered.length > 0) {
                const results = await Promise.all(discovered.map(async a => {
                    try {
                        const url = DashieAuth._addonUrl(`/api/ha/adopt/${encodeURIComponent(a.haDeviceId)}`);
                        const resp = await fetch(url, { method: 'POST' });
                        const body = await resp.json().catch(() => ({}));
                        if (!resp.ok) throw new Error(body?.message || body?.error || `HTTP ${resp.status}`);
                        return { item: a, ok: true };
                    } catch (e) {
                        return { item: a, ok: false, err: e?.message || String(e) };
                    }
                }));
                for (const r of results) {
                    if (r.ok) added++;
                    else failures.push({ name: r.item.name, reason: r.err });
                }
            }

            // Toasts
            if (added > 0) {
                Toast.success(`Added ${added} device${added === 1 ? '' : 's'}`);
            }
            if (failures.length > 0) {
                const which = failures.map(f => f.name).join(', ');
                Toast.warning(`${failures.length} device${failures.length === 1 ? "" : 's'} couldn't be added: ${which}`);
                console.warn('[DevicesClaim] add failures:', failures);
            }

            this._selected.clear();
            // Refresh the addable list + the main devices list so newly-linked
            // devices show up in Online/Offline. The add-on /api/ha/adopt route
            // triggers a worker refresh so discovered rows drop on next poll.
            await this.fetch();
            DevicesPage._lastListDevicesAt = 0;
            await DevicesPage._refreshSilent();
        } finally {
            this._claiming = false;
            App.renderPage();
        }
    },
};
