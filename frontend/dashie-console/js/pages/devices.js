/* ============================================================
   Devices Page
   ============================================================ */

const DevicesPage = {
    _detailDeviceId: null,
    _devices: null,
    _loading: false,
    _error: null,
    _saving: {},  // { [deviceId_field]: bool }

    render() {
        // Fetch on first render
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
            return this._devices ? `${this._devices.length} device${this._devices.length === 1 ? '' : 's'} registered` : '';
        }
        const device = this._findDevice(this._detailDeviceId);
        return device ? (device.device_type || '') : '';
    },

    // =========================================================

    async _fetchDevices() {
        this._loading = true;
        this._error = null;
        try {
            const result = await DashieAuth.dbRequest('list_devices', {});
            // Response shape: { success: true, devices: [...] } or { data: [...] }
            this._devices = result.devices || result.data || [];
            this._loading = false;
            App.renderPage();
        } catch (e) {
            console.error('[DevicesPage] Fetch failed:', e);
            this._error = e.message;
            this._loading = false;
            App.renderPage();
        }
    },

    _findDevice(deviceId) {
        if (!this._devices) return null;
        return this._devices.find(d => d.device_id === deviceId);
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
                    <strong>Failed to load devices:</strong> ${this._error}
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
        App.renderPage();
    },

    _renderList() {
        if (!this._devices || this._devices.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-state-icon">📱</div>
                    <div class="empty-state-text">No devices registered yet.</div>
                    <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: 8px;">
                        Sign in to Dashie on a tablet or Fire TV to register it.
                    </div>
                </div>
            `;
        }

        const cards = this._devices.map(d => this._renderDeviceCard(d)).join('');
        return `<div class="card-grid">${cards}</div>`;
    },

    _renderDeviceCard(device) {
        const icon = this._deviceIcon(device.device_type);
        const displaySettings = this._getDisplayHighlights(device);

        return `
            <div class="card card-clickable" onclick="DevicesPage.showDetail('${device.device_id}')">
                <div class="card-body device-card">
                    <div class="device-card-header">
                        <div class="device-card-icon">${icon}</div>
                        <div class="device-card-info">
                            <div class="device-card-name">${this._escape(device.device_name || 'Unnamed Device')}</div>
                            <div class="device-card-type">${this._escape(device.device_type || '—')}</div>
                            <div class="device-card-status">
                                Last active: ${this._formatTime(device.last_seen_at)}
                            </div>
                        </div>
                    </div>
                    ${displaySettings.length ? `
                        <div class="device-card-details">
                            ${displaySettings.map(s => `<span class="device-card-detail">${s}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    },

    _renderDetail() {
        const device = this._findDevice(this._detailDeviceId);
        if (!device) {
            return '<div class="empty-state"><div class="empty-state-text">Device not found</div></div>';
        }

        const online = this._isOnline(device);
        const settings = device.settings || {};

        // Extract settings by category with fallbacks
        const display = settings.display || {};
        const sleep = settings.sleep || {};
        const aiVoice = settings.aiVoice || {};

        const icon = this._deviceIcon(device.device_type);

        return `
            <div class="back-link" onclick="DevicesPage.backToList()">← Back to Devices</div>

            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
                <div class="device-card-icon" style="width: 48px; height: 48px; font-size: 24px;">${icon}</div>
                <div>
                    <div style="font-size: var(--font-size-xl); font-weight: 600;">${this._escape(device.device_name || 'Device')}</div>
                    <div style="font-size: var(--font-size-sm); color: var(--text-secondary);">
                        ${this._escape(device.device_type || '—')} ·
                        <span class="status-dot ${online ? 'online' : 'offline'}"></span>${online ? 'Online' : 'Offline'}
                    </div>
                </div>
            </div>

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
            // Send partial update — only the changed field within the category
            await DashieAuth.dbRequest('update_device_settings', {
                device_id: deviceId,
                category: category,
                value: { [key]: value },
            });

            // Update local cache — merge the new value into the cached device
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

    // =========================================================

    _isOnline(device) {
        if (!device.last_seen_at) return false;
        const lastSeen = new Date(device.last_seen_at).getTime();
        const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
        return lastSeen > fiveMinsAgo;
    },

    _deviceIcon(deviceType) {
        if (!deviceType) return '🖥';
        const lower = deviceType.toLowerCase();
        if (lower.includes('fire') || lower.includes('tv')) return '🖥';
        if (lower.includes('tablet') || lower.includes('sm-') || lower.includes('ipad')) return '📱';
        return '🖥';
    },

    _getDisplayHighlights(device) {
        const highlights = [];
        const display = device.settings?.display || {};
        const sleep = device.settings?.sleep || {};

        if (display['preferences.layoutMode']) {
            const layout = display['preferences.layoutMode'] === 'widgets' ? 'Widgets' : 'Single Panel';
            highlights.push(`Layout: ${layout}`);
        }
        if (display['preferences.theme']) {
            const theme = display['preferences.theme'];
            highlights.push(`Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)}`);
        }
        if (sleep['sleep.timerStart']) {
            highlights.push(`Sleep: ${this._formatTime24(sleep['sleep.timerStart'])}`);
        }
        return highlights.slice(0, 3);
    },

    _formatTime24(time24) {
        if (!time24) return '';
        const [h, m] = time24.split(':').map(Number);
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${String(m).padStart(2, '0')} ${period}`;
    },

    _formatTime(iso) {
        if (!iso) return '—';
        try {
            const then = new Date(iso).getTime();
            const now = Date.now();
            const diffSec = Math.floor((now - then) / 1000);

            if (diffSec < 60) return `${diffSec} sec ago`;
            if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
            if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hr ago`;
            return `${Math.floor(diffSec / 86400)} days ago`;
        } catch (e) {
            return iso;
        }
    },

    _escape(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
};
