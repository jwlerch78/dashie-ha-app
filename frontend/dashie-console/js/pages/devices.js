/* ============================================================
   Devices Page
   ------------------------------------------------------------
   Three sections on the list view:
     • Active    — live or recently-seen devices (last_seen_at < 30d)
     • Discovered — devices HA reports but which aren't in user_devices
                    for this user (from the add-on's /api/ha/status, so only
                    shows when running inside the add-on)
     • Archive   — stale devices (last_seen_at >= 30d), collapsed, hidden
                    if empty, with per-device Delete
   ------------------------------------------------------------ */

const DevicesPage = {
    _detailDeviceId: null,
    _devices: null,
    _loading: false,
    _error: null,
    _saving: {},  // { [deviceId_field]: bool }

    // Phase-2 additions
    _haStatus: null,          // add-on /api/ha/status response (or null)
    _haStatusFetchedAt: 0,
    _haStatusFetching: false, // single-flight guard for background refresh
    _archiveExpanded: false,
    _deletingId: null,        // device_id currently being deleted
    // Rename + conflict state lives on DevicesRename (see devices-rename.js).

    ARCHIVE_THRESHOLD_DAYS: 30,
    LIVE_THRESHOLD_SECONDS: 90,   // metrics_updated_at newer than this → "live" chip
    HA_STATUS_MAX_AGE_MS: 15 * 1000, // refetch /api/ha/status if older than this on render
    AUTO_REFRESH_MS: 60 * 1000,   // chip+status poll cadence (doesn't bust screenshot URLs)

    _pollTimer: null,

    render() {
        if (!this._devices && !this._loading && !this._error) {
            this._fetchDevices();
            return this._renderLoading();
        }
        if (this._loading) return this._renderLoading();
        if (this._error) return this._renderError();
        if (this._detailDeviceId) return this._renderDetail();
        return this._renderList();
    },

    topBarTitle() {
        if (this._detailDeviceId) {
            const device = this._findDevice(this._detailDeviceId);
            return device ? (device.device_name || 'Device') : 'Device';
        }
        return 'Devices';
    },

    topBarSubtitle() {
        if (!this._detailDeviceId) {
            if (!this._devices) return '';
            const active = this._devices.filter(d => !this._isArchived(d)).length;
            return `${active} active`;
        }
        const device = this._findDevice(this._detailDeviceId);
        return device ? this._typeLabel(device) : '';
    },

    async _fetchDevices() {
        this._loading = true;
        this._error = null;
        try {
            const [devicesResult] = await Promise.all([
                DashieAuth.dbRequest('list_devices', { tv_only: false, include_inactive: true }),
                this._fetchAddonStatus(),  // fire-and-forget inside
            ]);
            this._devices = devicesResult.devices || devicesResult.data || [];
            this._loading = false;
            this._startAutoRefresh();
            App.renderPage();
        } catch (e) {
            console.error('[DevicesPage] Fetch failed:', e);
            this._error = e.message;
            this._loading = false;
            App.renderPage();
        }
    },

    /** Background re-fetch every AUTO_REFRESH_MS while page is visible. */
    _startAutoRefresh() {
        if (this._pollTimer) return;
        this._pollTimer = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            this._refreshSilent();
        }, this.AUTO_REFRESH_MS);
    },

    async _refreshSilent() {
        try {
            const result = await DashieAuth.dbRequest('list_devices', { tv_only: false, include_inactive: true });
            this._devices = result.devices || result.data || [];
            this._haStatusFetchedAt = 0;
            await this._fetchAddonStatus();
            App.renderPage();
        } catch (e) {
            console.warn('[DevicesPage] auto-refresh failed:', e.message);
        }
    },

    /** Manual refresh: auto poll + bump every screenshot cache-bust. */
    _manualRefreshing: false,
    async _manualRefresh() {
        if (this._manualRefreshing) return;
        this._manualRefreshing = true;
        App.renderPage();
        try {
            const now = Date.now();
            for (const d of (this._devices || [])) {
                DevicesCard._screenshotTs[d.device_id] = now;
            }
            await this._refreshSilent();
        } finally {
            this._manualRefreshing = false;
            App.renderPage();
        }
    },

    /**
     * Grab the add-on's worker status so we can surface "Discovered but
     * not claimed" devices. Only meaningful when Console is running inside
     * the add-on — otherwise _addonUrl resolves to an external path that
     * won't exist; we swallow the error and show no Discovered section.
     */
    async _fetchAddonStatus() {
        if (!DashieAuth.isAddonMode) {
            this._haStatus = null;
            return;
        }
        if (this._haStatusFetching) return;
        this._haStatusFetching = true;
        try {
            const resp = await fetch(DashieAuth._addonUrl('/api/ha/status'), { cache: 'no-store' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            this._haStatus = await resp.json();
            this._haStatusFetchedAt = Date.now();
        } catch (e) {
            console.warn('[DevicesPage] /api/ha/status unavailable:', e.message);
            this._haStatus = null;
        } finally {
            this._haStatusFetching = false;
        }
    },

    /** Kick off a background refresh if the cached /api/ha/status is stale. */
    _maybeRefreshAddonStatus() {
        if (!DashieAuth.isAddonMode) return;
        if (this._haStatusFetching) return;
        const age = Date.now() - this._haStatusFetchedAt;
        if (age < this.HA_STATUS_MAX_AGE_MS) return;
        this._fetchAddonStatus().then(() => App.renderPage());
    },

    _findDevice(deviceId) {
        if (!this._devices) return null;
        return this._devices.find(d => d.device_id === deviceId);
    },

    _isArchived(device) {
        if (!device.last_seen_at) return false;
        const age = Date.now() - new Date(device.last_seen_at).getTime();
        return age > this.ARCHIVE_THRESHOLD_DAYS * 86400 * 1000;
    },

    _isLive(device) {
        if (!device.metrics_updated_at) return false;
        const age = (Date.now() - new Date(device.metrics_updated_at).getTime()) / 1000;
        return age < this.LIVE_THRESHOLD_SECONDS;
    },

    _discoveredDevices() {
        return this._haStatus?.lastRun?.upsertResult?.unmatched || [];
    },

    _conflictHaName(device) { return DevicesRename.conflictHaName(device, this._haStatus); },
    _conflictDevices() {
        return DevicesRename.conflictDevices(this._devices, d => this._isArchived(d), this._haStatus);
    },

    /** Look up the HA entity slug (e.g. 'fire_tv') for a Dashie device_id from
     *  the worker's last-poll synced[] map. Used to deep-link to HA history. */
    _haSlugForDevice(deviceId) {
        const synced = this._haStatus?.lastRun?.upsertResult?.synced || [];
        const entry = synced.find(s => s?.device_id === deviceId);
        return entry?.ha_slug || null;
    },

    _renderLoading() {
        return `
            <div style="display: flex; align-items: center; justify-content: center; padding: 60px;">
                <div style="text-align: center;">
                    <div style="width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 12px;"></div>
                    <div style="color: var(--text-secondary); font-size: var(--font-size-sm);">Loading devices...</div>
                </div>
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
            </div>
        `;
    },

    _renderError() {
        return `
            <div class="card">
                <div class="card-body" style="color: var(--status-error);">
                    <strong>Failed to load devices:</strong> ${this._escape(this._error)}
                    <div style="margin-top: 12px;">
                        <button class="btn btn-secondary btn-sm" onclick="DevicesPage._retry()">Retry</button>
                    </div>
                </div>
            </div>
        `;
    },

    _retry() {
        this._error = null;
        this._devices = null;
        this._haStatus = null;
        App.renderPage();
    },

    _renderList() {
        // Background-refresh /api/ha/status if it's gone stale since last fetch.
        // Self-heals the "page loaded before worker's first poll" race.
        this._maybeRefreshAddonStatus();

        if (!this._devices || this._devices.length === 0) {
            // Even with zero devices, the Discovered section may still have something
            return this._renderDiscoveredSection() || `
                <div class="empty-state">
                    <div class="empty-state-icon">📱</div>
                    <div class="empty-state-text">No devices registered yet.</div>
                    <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: 8px;">
                        Sign in to Dashie on a tablet or Fire TV to register it.
                    </div>
                </div>
            `;
        }

        const active = this._devices.filter(d => !this._isArchived(d));
        const archived = this._devices.filter(d => this._isArchived(d));

        const conflicts = this._conflictDevices();
        return `
            ${DevicesRename.renderBanner(conflicts)}
            ${this._renderActiveSection(active)}
            ${this._renderDiscoveredSection()}
            ${this._renderArchiveSection(archived)}
            ${DevicesRename.conflictModal ? DevicesRename.renderModal(conflicts, d => this._conflictHaName(d)) : ''}
            ${DevicesCard.renderSliderModal()}
            ${DevicesCard.renderScreenshotModal()}
            ${DevicesCard.renderHistoryModal()}
        `;
    },

    _renderActiveSection(devices) {
        const busy = this._manualRefreshing;
        const header = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Active (${devices.length})</span>
                <button title="Refresh thumbnails and metrics" onclick="DevicesPage._manualRefresh()" ${busy ? 'disabled' : ''}
                    style="background: none; border: 1px solid var(--border, #d1d5db); border-radius: 4px; padding: 4px 10px; cursor: ${busy ? 'wait' : 'pointer'}; line-height: 0; opacity: ${busy ? 0.5 : 0.85};">
                    <img src="assets/icons/icon-reload.svg" alt="Refresh" style="width: 14px; height: 14px; vertical-align: middle;">
                </button>
            </div>
        `;
        if (devices.length === 0) {
            return `${header}<p class="empty-state-text" style="margin: 16px 0;">No active devices in the last ${this.ARCHIVE_THRESHOLD_DAYS} days.</p>`;
        }
        const cards = devices.map(d => this._renderDeviceCard(d)).join('');
        return `${header}<div class="devices-grid">${cards}</div>`;
    },

    _renderDiscoveredSection() {
        const discovered = this._discoveredDevices();
        if (discovered.length === 0) return '';

        const cards = discovered.map(d => `
            <div class="card">
                <div class="card-body device-card">
                    <div class="device-card-header">
                        <div class="device-card-icon">🔍</div>
                        <div class="device-card-info">
                            <div class="device-card-name">${this._escape(d.device_name || 'Unknown device')}</div>
                            <div class="device-card-type">Reported by Home Assistant</div>
                            <div class="device-card-status">
                                This device is pushing state to HA but isn't linked to your account yet.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');

        return `
            <div class="section-header" style="margin-top: 32px;">Discovered (${discovered.length})</div>
            <p class="page-summary" style="margin-top: -4px; margin-bottom: 12px;">
                Home Assistant sees these devices but they aren't linked to your account.
                Sign into Dashie on each tablet to register it, or use the Claim flow
                (coming soon) to link them here.
            </p>
            <div class="card-grid">${cards}</div>
        `;
    },

    _renderArchiveSection(devices) {
        if (devices.length === 0) return '';

        const caret = this._archiveExpanded ? '▾' : '▸';
        if (!this._archiveExpanded) {
            return `
                <div class="section-header" style="margin-top: 32px; cursor: pointer;" onclick="DevicesPage._toggleArchive()">
                    ${caret} Archived (${devices.length})
                </div>
            `;
        }

        const rows = devices.map(d => `
            <div class="card" style="margin-bottom: 8px;">
                <div class="card-body" style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                    <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
                        <div class="device-card-icon">${this._deviceIcon(d.device_type)}</div>
                        <div style="min-width: 0;">
                            <div style="font-weight: 500;">${this._escape(d.device_name || 'Unnamed')}</div>
                            <div style="color: var(--text-muted); font-size: var(--font-size-sm);">
                                ${this._escape(d.device_type || '—')} · last seen ${this._formatTime(d.last_seen_at)}
                            </div>
                        </div>
                    </div>
                    <div style="flex-shrink: 0;">
                        <button class="btn btn-secondary btn-sm" ${this._deletingId === d.device_id ? 'disabled' : ''}
                            onclick="DevicesPage._deleteArchived('${this._escape(d.device_id)}', '${this._escape(d.device_name || 'this device')}')">
                            ${this._deletingId === d.device_id ? 'Deleting…' : 'Delete'}
                        </button>
                    </div>
                </div>
            </div>
        `).join('');

        return `
            <div class="section-header" style="margin-top: 32px; cursor: pointer;" onclick="DevicesPage._toggleArchive()">
                ${caret} Archived (${devices.length})
            </div>
            <div>${rows}</div>
        `;
    },

    _toggleArchive() {
        this._archiveExpanded = !this._archiveExpanded;
        App.renderPage();
    },

    async _deleteArchived(deviceId, deviceName) {
        if (!confirm(`Delete "${deviceName}" from your devices? This cannot be undone.`)) return;
        this._deletingId = deviceId;
        App.renderPage();
        try {
            await DashieAuth.dbRequest('delete_device', { device_id: deviceId });
            // Drop it from the local cache
            this._devices = this._devices.filter(d => d.device_id !== deviceId);
            Toast.success(`Deleted "${deviceName}"`);
        } catch (e) {
            console.error('[DevicesPage] Delete failed:', e);
            Toast.error(Toast.friendly(e, 'delete this device'));
        } finally {
            this._deletingId = null;
            App.renderPage();
        }
    },

    _renderDeviceCard(device) { return DevicesCard.render(device); },

    _renderDetail() { return DevicesDetail.render(this._findDevice(this._detailDeviceId)); },

    async _onSettingChange(deviceId, category, key, value) {
        const savingKey = `${deviceId}_${key}`;
        this._saving[savingKey] = true;
        App.renderPage();

        try {
            await DashieAuth.dbRequest('update_device_settings', {
                device_id: deviceId,
                category: category,
                value: { [key]: value },
            });
            const device = this._findDevice(deviceId);
            if (device) {
                device.settings = device.settings || {};
                device.settings[category] = device.settings[category] || {};
                device.settings[category][key] = value;
            }
        } catch (e) {
            console.error('[DevicesPage] Save failed:', e);
            Toast.error(Toast.friendly(e, 'save this setting'));
        } finally {
            delete this._saving[savingKey];
            App.renderPage();
        }
    },

    showDetail(deviceId) {
        this._detailDeviceId = deviceId;
        App.renderPage();
    },

    backToList() {
        this._detailDeviceId = null;
        App.renderPage();
    },

    _deviceIcon(deviceType) {
        if (!deviceType) return '🖥';
        const lower = deviceType.toLowerCase();
        if (lower.includes('fire') || lower.includes('tv')) return '🖥';
        if (lower.includes('tablet') || lower.includes('sm-') || lower.includes('ipad')) return '📱';
        return '🖥';
    },

    /** Friendly type label combining the registered category prefix with the
     *  HA-reported model. Examples: "Tablet · SM-X200", "TV · AFTMM". */
    _typeLabel(device) {
        const model = device?.metrics?.app?.device_model || device?.device_metadata?.model || null;
        const raw = device?.device_type || '';
        const prefix = raw.split('_')[0];
        const cat = { tv: 'TV', tablet: 'Tablet', computer: 'Computer', phone: 'Phone' }[prefix]
            || (prefix ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : null);
        if (model && cat) return `${cat} · ${model}`;
        return model || raw || '—';
    },

    _formatTime(iso) {
        if (!iso) return '—';
        try {
            const then = new Date(iso).getTime();
            const now = Date.now();
            const diffSec = Math.floor((now - then) / 1000);
            if (diffSec < 60) return `${diffSec}s ago`;
            if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
            if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
            return `${Math.floor(diffSec / 86400)}d ago`;
        } catch (e) {
            return iso;
        }
    },

    _escape(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
};
