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
            App.renderPage();
        } catch (e) {
            console.error('[DevicesPage] Fetch failed:', e);
            this._error = e.message;
            this._loading = false;
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
        `;
    },

    _renderActiveSection(devices) {
        if (devices.length === 0) {
            return `<p class="empty-state-text" style="margin: 16px 0;">No active devices in the last ${this.ARCHIVE_THRESHOLD_DAYS} days.</p>`;
        }
        const cards = devices.map(d => this._renderDeviceCard(d)).join('');
        return `<div class="card-grid">${cards}</div>`;
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

    _renderDeviceCard(device) {
        const icon = this._deviceIcon(device.device_type);
        const live = this._isLive(device);
        const chips = this._getMetricsChips(device);
        const statusChip = live
            ? '<span class="status-dot online"></span> Live'
            : `<span class="status-dot offline"></span> ${this._formatTime(device.last_seen_at)}`;
        const idAttr = this._escape(device.device_id);
        return `
            <div class="card card-clickable" onclick="DevicesPage.showDetail('${idAttr}')">
                <div class="card-body device-card">
                    <div class="device-card-header">
                        <div class="device-card-icon">${icon}</div>
                        <div class="device-card-info">
                            ${DevicesRename.renderNameRow(device, this._conflictHaName(device), 'card')}
                            <div class="device-card-type">${this._escape(this._typeLabel(device))}</div>
                            <div class="device-card-status">${statusChip}</div>
                        </div>
                    </div>
                    ${chips.length ? `<div class="device-card-details">${chips.map(c => `<span class="device-card-detail">${c}</span>`).join('')}</div>` : ''}
                </div>
            </div>
        `;
    },

    /** Chips built from user_devices.metrics JSONB (populated by the HA add-on worker). */
    _getMetricsChips(device) {
        const m = device.metrics || {};
        const chips = [];
        if (m.battery?.level != null) {
            const icon = m.battery.charging ? '⚡' : '🔋';
            chips.push(`${icon} ${m.battery.level}%`);
        }
        if (m.network?.wifi_signal_percent != null) {
            chips.push(`📶 ${m.network.wifi_signal_percent}%`);
        }
        if (m.system?.ram_used_percent != null) {
            chips.push(`RAM ${m.system.ram_used_percent}%`);
        }
        if (m.app?.app_version) {
            chips.push(`v${this._escape(m.app.app_version)}`);
        }
        return chips;
    },

    _renderDetail() {
        const device = this._findDevice(this._detailDeviceId);
        if (!device) {
            return '<div class="empty-state"><div class="empty-state-text">Device not found</div></div>';
        }

        const live = this._isLive(device);
        const settings = device.settings || {};
        const display = settings.display || {};
        const sleep = settings.sleep || {};
        const aiVoice = settings.aiVoice || {};
        const icon = this._deviceIcon(device.device_type);

        const conflict = this._conflictHaName(device);
        const conflictBadge = conflict ? `
            <div style="margin-top: 4px; font-size: var(--font-size-sm); color: var(--accent);">
                ⚠ HA has a different name: "${this._escape(conflict)}".
                <a href="#" onclick="event.preventDefault(); DevicesRename.openModal()">Resolve</a>
            </div>
        ` : '';

        return `
            <div class="back-link" onclick="DevicesPage.backToList()">← Back to Devices</div>

            <div style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 24px;">
                <div class="device-card-icon" style="width: 48px; height: 48px; font-size: 24px; flex-shrink: 0;">${icon}</div>
                <div style="flex: 1; min-width: 0;">
                    ${DevicesRename.renderNameRow(device, conflict, 'detail')}
                    <div style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-top: 4px;">
                        ${this._escape(this._typeLabel(device))} ·
                        <span class="status-dot ${live ? 'online' : 'offline'}"></span>${live ? 'Live' : 'Offline'}
                    </div>
                    ${conflictBadge}
                </div>
            </div>

            ${this._renderMetricsPanel(device)}

            <div class="section-header">Display</div>
            <div class="card">
                <div class="card-body">
                    <div class="form-grid">
                        ${this._settingSelect(device, 'display', 'preferences.layoutMode',
                            'Layout', display['preferences.layoutMode'] || 'widgets',
                            [['widgets', 'Widgets'], ['single-panel', 'Single Panel']])}
                        ${this._settingSelect(device, 'display', 'preferences.theme',
                            'Theme', display['preferences.theme'] || 'default',
                            [['default', 'Default'], ['midnight', 'Midnight'], ['ocean', 'Ocean'], ['forest', 'Forest']])}
                        ${this._settingSelect(device, 'display', 'preferences.dashboardZoom',
                            'Dashboard Zoom', String(display['preferences.dashboardZoom'] || 100),
                            [['80', '80%'], ['90', '90%'], ['100', '100%'], ['110', '110%'], ['120', '120%']])}
                        ${this._settingSelect(device, 'display', 'preferences.sidebarIconSize',
                            'Sidebar Size', display['preferences.sidebarIconSize'] || 'medium',
                            [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}
                    </div>
                </div>
            </div>

            <div class="section-header">Sleep & Screensaver</div>
            <div class="card">
                <div class="card-body">
                    <div class="form-grid">
                        ${this._settingSelect(device, 'sleep', 'sleep.timerStart',
                            'Sleep Time', sleep['sleep.timerStart'] || '22:00',
                            [['21:00', '9:00 PM'], ['21:30', '9:30 PM'], ['22:00', '10:00 PM'], ['22:30', '10:30 PM'], ['23:00', '11:00 PM']])}
                        ${this._settingSelect(device, 'sleep', 'sleep.timerEnd',
                            'Wake Time', sleep['sleep.timerEnd'] || '07:00',
                            [['05:30', '5:30 AM'], ['06:00', '6:00 AM'], ['06:30', '6:30 AM'], ['07:00', '7:00 AM'], ['07:30', '7:30 AM']])}
                        ${this._settingSelect(device, 'sleep', 'sleep.method',
                            'Sleep Method', sleep['sleep.method'] || 'power-off',
                            [['power-off', 'Power Off'], ['screen-off', 'Screen Off'], ['screensaver', 'Screensaver']])}
                    </div>
                </div>
            </div>

            <div class="section-header">Voice & AI</div>
            <div class="card">
                <div class="card-body">
                    <div class="form-grid">
                        ${this._settingSelect(device, 'aiVoice', 'aiVoice.personality',
                            'AI Personality', aiVoice['aiVoice.personality'] || 'friendly',
                            [['friendly', 'Friendly'], ['calm', 'Calm'], ['professional', 'Professional'], ['playful', 'Playful']])}
                        ${this._settingSelect(device, 'aiVoice', 'aiVoice.voice',
                            'Voice', aiVoice['aiVoice.voice'] || 'rachel',
                            [['rachel', 'Rachel'], ['adam', 'Adam'], ['aria', 'Aria'], ['thomas', 'Thomas'], ['jessica', 'Jessica']])}
                    </div>
                </div>
            </div>

            <p class="page-summary">
                Changes apply to the device immediately via Supabase real-time broadcast.
                Last check-in: ${this._formatTime(device.last_seen_at)}
            </p>
        `;
    },

    /** Live metrics panel on the detail view — null-safe on offline devices. */
    _renderMetricsPanel(device) {
        const m = device.metrics;
        if (!m) return '';
        const join = arr => arr.filter(Boolean).join(' · ');
        const rows = [
            m.battery && ['Battery', join([
                m.battery.level != null && `${m.battery.level}%`,
                m.battery.charging && `charging via ${m.battery.plug_source || 'AC'}`,
            ])],
            m.system?.ram_used_percent != null && ['RAM', join([
                `${m.system.ram_used_percent}%`,
                m.system.ram_total_mb && `${m.system.ram_total_mb} MB total`,
                m.system.ram_available_mb != null && `${m.system.ram_available_mb} MB free`,
            ])],
            m.network?.wifi_signal_percent != null && ['Network', join([
                `${m.network.wifi_signal_percent}%`,
                m.network.ip_address,
                m.network.wifi_ssid && m.network.wifi_ssid !== '<unknown ssid>' && `"${m.network.wifi_ssid}"`,
            ])],
            m.storage?.free_gb != null && ['Storage',
                `${m.storage.free_gb} GB free` + (m.storage.total_gb ? ` of ${m.storage.total_gb} GB` : '')],
            m.app?.app_version && ['App', join([
                `v${m.app.app_version}`,
                m.app.android_version && `Android ${m.app.android_version}`,
                m.app.device_model,
            ])],
            m.app?.current_page && ['Current page', m.app.current_page],
        ].filter(r => r && r[1]);
        if (rows.length === 0) return '';

        return `
            <div class="section-header">Live Metrics</div>
            <div class="card">
                <div class="card-body">
                    <div class="form-grid">
                        ${rows.map(([label, val]) => `
                            <div class="form-group">
                                <label class="form-label">${this._escape(label)}</label>
                                <div style="font-size: var(--font-size-sm);">${this._escape(val)}</div>
                            </div>
                        `).join('')}
                    </div>
                    <div style="margin-top: 12px; color: var(--text-muted); font-size: var(--font-size-sm);">
                        Updated ${this._formatTime(device.metrics_updated_at)}
                    </div>
                </div>
            </div>
        `;
    },

    _settingSelect(device, category, key, label, currentValue, options) {
        const savingKey = `${device.device_id}_${key}`;
        const isSaving = this._saving[savingKey];
        const optionsHtml = options.map(([val, text]) =>
            `<option value="${val}" ${val === currentValue ? 'selected' : ''}>${text}</option>`
        ).join('');

        return `
            <div class="form-group">
                <label class="form-label">${label} ${isSaving ? '<span style="color: var(--text-muted); font-weight: 400; text-transform: none; font-size: 10px;">saving…</span>' : ''}</label>
                <select class="form-select"
                    onchange="DevicesPage._onSettingChange('${device.device_id}', '${category}', '${key}', this.value)"
                    ${isSaving ? 'disabled' : ''}>
                    ${optionsHtml}
                </select>
            </div>
        `;
    },

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
