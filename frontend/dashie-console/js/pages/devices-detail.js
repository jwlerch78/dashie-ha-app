/* ============================================================
   Devices Detail — per-device drill-down view rendered when a card
   is clicked. Holds the live-metrics panel, the settings groups
   (Display / Sleep & Screensaver / Voice & AI), and the rename-conflict
   resolution affordance. Click handlers + state remain on DevicesPage.
   ============================================================ */

const DevicesDetail = {
    render(device) {
        if (!device) {
            return '<div class="empty-state"><div class="empty-state-text">Device not found</div></div>';
        }
        const live = DevicesPage._isLive(device);
        const settings = device.settings || {};
        const display = settings.display || {};
        const sleep = settings.sleep || {};
        const aiVoice = settings.aiVoice || {};
        const icon = DevicesPage._deviceIcon(device.device_type);
        const conflict = DevicesPage._conflictHaName(device);
        const conflictBadge = conflict ? `
            <div style="margin-top: 4px; font-size: var(--font-size-sm); color: var(--accent);">
                ⚠ HA has a different name: "${DevicesPage._escape(conflict)}".
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
                        ${DevicesPage._escape(DevicesPage._typeLabel(device))} ·
                        <span class="status-dot ${live ? 'online' : 'offline'}"></span>${live ? 'Live' : 'Offline'}
                    </div>
                    ${conflictBadge}
                </div>
            </div>
            ${this._renderMetricsPanel(device)}
            ${this._renderDisplaySection(device, display)}
            ${this._renderSleepSection(device, sleep)}
            ${this._renderVoiceSection(device, aiVoice)}
            <p class="page-summary">
                Changes apply to the device immediately via Supabase real-time broadcast.
                Last check-in: ${DevicesPage._formatTime(device.last_seen_at)}
            </p>
            ${DevicesRename.conflictModal ? DevicesRename.renderModal(DevicesPage._conflictDevices(), d => DevicesPage._conflictHaName(d)) : ''}
            ${DevicesCard.renderSliderModal()}
            ${DevicesCard.renderScreenshotModal()}
            ${DevicesCard.renderHistoryModal()}
        `;
    },

    _renderDisplaySection(device, display) {
        return `
            <div class="section-header">Display</div>
            <div class="card"><div class="card-body"><div class="form-grid">
                ${this.settingSelect(device, 'display', 'preferences.layoutMode',
                    'Layout', display['preferences.layoutMode'] || 'widgets',
                    [['widgets', 'Widgets'], ['single-panel', 'Single Panel']])}
                ${this.settingSelect(device, 'display', 'preferences.theme',
                    'Theme', display['preferences.theme'] || 'default',
                    [['default', 'Default'], ['midnight', 'Midnight'], ['ocean', 'Ocean'], ['forest', 'Forest']])}
                ${this.settingSelect(device, 'display', 'preferences.dashboardZoom',
                    'Dashboard Zoom', String(display['preferences.dashboardZoom'] || 100),
                    [['80', '80%'], ['90', '90%'], ['100', '100%'], ['110', '110%'], ['120', '120%']])}
                ${this.settingSelect(device, 'display', 'preferences.sidebarIconSize',
                    'Sidebar Size', display['preferences.sidebarIconSize'] || 'medium',
                    [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}
            </div></div></div>
        `;
    },

    _renderSleepSection(device, sleep) {
        return `
            <div class="section-header">Sleep & Screensaver</div>
            <div class="card"><div class="card-body"><div class="form-grid">
                ${this.settingSelect(device, 'sleep', 'sleep.timerStart',
                    'Sleep Time', sleep['sleep.timerStart'] || '22:00',
                    [['21:00', '9:00 PM'], ['21:30', '9:30 PM'], ['22:00', '10:00 PM'], ['22:30', '10:30 PM'], ['23:00', '11:00 PM']])}
                ${this.settingSelect(device, 'sleep', 'sleep.timerEnd',
                    'Wake Time', sleep['sleep.timerEnd'] || '07:00',
                    [['05:30', '5:30 AM'], ['06:00', '6:00 AM'], ['06:30', '6:30 AM'], ['07:00', '7:00 AM'], ['07:30', '7:30 AM']])}
                ${this.settingSelect(device, 'sleep', 'sleep.method',
                    'Sleep Method', sleep['sleep.method'] || 'power-off',
                    [['power-off', 'Power Off'], ['screen-off', 'Screen Off'], ['screensaver', 'Screensaver']])}
            </div></div></div>
        `;
    },

    _renderVoiceSection(device, aiVoice) {
        return `
            <div class="section-header">Voice & AI</div>
            <div class="card"><div class="card-body"><div class="form-grid">
                ${this.settingSelect(device, 'aiVoice', 'aiVoice.personality',
                    'AI Personality', aiVoice['aiVoice.personality'] || 'friendly',
                    [['friendly', 'Friendly'], ['calm', 'Calm'], ['professional', 'Professional'], ['playful', 'Playful']])}
                ${this.settingSelect(device, 'aiVoice', 'aiVoice.voice',
                    'Voice', aiVoice['aiVoice.voice'] || 'rachel',
                    [['rachel', 'Rachel'], ['adam', 'Adam'], ['aria', 'Aria'], ['thomas', 'Thomas'], ['jessica', 'Jessica']])}
            </div></div></div>
        `;
    },

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
            <div class="card"><div class="card-body">
                <div class="form-grid">
                    ${rows.map(([label, val]) => `
                        <div class="form-group">
                            <label class="form-label">${DevicesPage._escape(label)}</label>
                            <div style="font-size: var(--font-size-sm);">${DevicesPage._escape(val)}</div>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top: 12px; color: var(--text-muted); font-size: var(--font-size-sm);">
                    Updated ${DevicesPage._formatTime(device.metrics_updated_at)}
                </div>
            </div></div>
        `;
    },

    settingSelect(device, category, key, label, currentValue, options) {
        const savingKey = `${device.device_id}_${key}`;
        const isSaving = DevicesPage._saving[savingKey];
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
};
