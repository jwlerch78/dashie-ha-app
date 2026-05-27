/* ============================================================
   Devices Detail — per-device drill-down view rendered when a card
   is clicked.

   Section order:
     1. Header (name + type + status + last-seen + rename action)
     2. Quick Controls (lock / screen / dark mode / camera / reload /
        brightness / volume — pulled in from the device card)
     3. Live Metrics (battery / RAM / network / storage / app / page)
     4. Display & Theme
     5. Sleep & Screensaver
     6. Voice & AI
     7. Photos / Slideshow
     8. Device Behavior (HA switches not surfaced elsewhere)
     9. Admin Actions (HA buttons — relaunch / reboot / clear cache…)
    10. Danger Zone (soft + permanent delete)

   Reuses DevicesCard.{toggleSwitch, pressButton, openSlider} for
   control invocations. Reuses settingSelect() for dropdowns.
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
        const voice = settings.voice || {};
        const photos = settings.photos || {};
        const m = device.metrics || {};
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
            ${this._renderQuickControls(device, m, live)}
            ${this._renderMetricsPanel(device)}
            ${this._renderDisplaySection(device, display)}
            ${this._renderSleepSection(device, sleep)}
            ${this._renderVoiceSection(device, aiVoice, voice)}
            ${this._renderPhotosSection(device, photos)}
            ${this._renderBehaviorSection(device, m)}
            ${this._renderAdminSection(device, m)}
            ${this._renderDangerZone(device)}
            <p class="page-summary">
                Changes apply to the device immediately via Supabase real-time broadcast.
                Last check-in: ${DevicesPage._formatTime(device.last_seen_at)}
            </p>
            ${DevicesRename.conflictModal ? DevicesRename.renderModal(DevicesPage._conflictDevices(), d => DevicesPage._conflictHaName(d)) : ''}
            ${DevicesCard.renderSliderModal()}
            ${DevicesCard.renderScreenshotModal()}
            ${DevicesCard.renderHistoryModal()}
            ${DevicesCard.renderCameraModal()}
        `;
    },

    // =========================================================
    //  Quick Controls — primary device actions (lock / screen /
    //  dark mode / camera / reload / brightness / volume)
    // =========================================================

    _renderQuickControls(device, m, live) {
        if (!live) {
            return `
                <div class="section-header">Quick Controls</div>
                <div class="card"><div class="card-body" style="color: var(--text-muted); font-size: var(--font-size-sm);">
                    Device is offline. Quick controls become available when the device checks in.
                </div></div>
            `;
        }
        const idAttr = DevicesPage._escape(device.device_id);
        const controls = m.controls || {};
        const buttons = [];

        // Reload — always available for an online device
        const reloadBusy = !!DevicesCard._busyControl[`${device.device_id}:reload`];
        buttons.push(`
            <button title="Reload the dashboard webview on this device" ${reloadBusy ? 'disabled' : ''}
                onclick="DevicesCard.pressButton('${idAttr}', 'reload')"
                style="${this._controlBtnStyle(reloadBusy)}">
                <img src="assets/icons/icon-reload.svg" alt="" style="width: 16px; height: 16px;">
                <span>Reload</span>
            </button>
        `);

        // Lock toggle — controls.lock present means HA reports a lock switch
        if (controls.lock !== undefined) {
            const locked = !!controls.lock;
            const busy = !!DevicesCard._busyControl[`${device.device_id}:lock`];
            buttons.push(this._toggleBtn(idAttr, 'lock', locked, busy,
                locked ? 'icon-lock.svg' : 'icon-unlock.svg',
                locked ? 'Locked' : 'Unlocked',
                locked ? 'Locked — tap to unlock' : 'Unlocked — tap to lock'));
        }

        // Screen on/off
        if (controls.screen !== undefined) {
            const on = controls.screen !== false;
            const busy = !!DevicesCard._busyControl[`${device.device_id}:screen`];
            buttons.push(this._toggleBtn(idAttr, 'screen', on, busy,
                'icon-tv.svg',
                on ? 'Screen on' : 'Screen off',
                on ? 'Screen on — tap to turn off' : 'Screen off — tap to turn on'));
        }

        // Dark mode
        if (controls.dark_mode !== undefined) {
            const dark = !!controls.dark_mode;
            const busy = !!DevicesCard._busyControl[`${device.device_id}:dark_mode`];
            buttons.push(this._toggleBtn(idAttr, 'dark_mode', dark, busy,
                dark ? 'icon-moon.svg' : 'icon-sun.svg',
                dark ? 'Dark mode' : 'Light mode',
                dark ? 'Dark mode — tap for light' : 'Light mode — tap for dark'));
        }

        // Camera stream toggle (only when device has a camera)
        if (controls.camera_resolution !== undefined || controls.camera_stream_enabled !== undefined) {
            const on = !!(controls.camera_streaming || controls.camera_stream_enabled);
            const busy = !!DevicesCard._busyControl[`${device.device_id}:camera_stream_enabled`];
            buttons.push(this._toggleBtn(idAttr, 'camera_stream_enabled', on, busy,
                'icon-video-camera.svg',
                on ? 'Camera on' : 'Camera off',
                on ? 'Camera streaming — tap to stop' : 'Camera off — tap to start'));
        }

        // Volume slider (when volume is present)
        if (controls.volume != null) {
            const display = DevicesCard._scaleTo10(controls.volume, controls.volume_max);
            const muted = controls.volume === 0;
            buttons.push(`
                <button title="Adjust speaker volume"
                    onclick="DevicesCard.openSlider('${idAttr}', 'volume', ${controls.volume}, ${controls.volume_max ?? 'null'})"
                    style="${this._controlBtnStyle(false)}">
                    <img src="assets/icons/${muted ? 'icon-volume-mute.svg' : 'icon-volume-high.svg'}" alt="" style="width: 16px; height: 16px;">
                    <span>${muted ? 'Muted' : `Volume ${display}`}</span>
                </button>
            `);
        }

        // Brightness slider
        if (controls.brightness != null) {
            const display = DevicesCard._scaleTo10(controls.brightness, controls.brightness_max);
            buttons.push(`
                <button title="Adjust screen brightness"
                    onclick="DevicesCard.openSlider('${idAttr}', 'brightness', ${controls.brightness}, ${controls.brightness_max ?? 'null'})"
                    style="${this._controlBtnStyle(false)}">
                    <img src="assets/icons/icon-sun.svg" alt="" style="width: 16px; height: 16px;">
                    <span>Brightness ${display}</span>
                </button>
            `);
        }

        if (buttons.length === 0) {
            return '';
        }
        return `
            <div class="section-header">Quick Controls</div>
            <div class="card"><div class="card-body">
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${buttons.join('')}
                </div>
            </div></div>
        `;
    },

    _toggleBtn(idAttr, role, isOn, busy, iconFile, label, title) {
        return `
            <button title="${DevicesPage._escape(title)}" ${busy ? 'disabled' : ''}
                onclick="DevicesCard.toggleSwitch('${idAttr}', '${role}', ${isOn})"
                style="${this._controlBtnStyle(busy, isOn)}">
                <img src="assets/icons/${iconFile}" alt="" style="width: 16px; height: 16px; ${isOn ? 'filter: brightness(0) invert(1);' : ''}">
                <span>${label}</span>
            </button>
        `;
    },

    _controlBtnStyle(busy, isOn = false) {
        const bg = isOn ? '#10b981' : '#f3f4f6';
        const color = isOn ? '#fff' : '#1f2937';
        const border = isOn ? '#10b981' : '#d1d5db';
        return `display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 999px; border: 1px solid ${border}; background: ${bg}; color: ${color}; cursor: ${busy ? 'wait' : 'pointer'}; opacity: ${busy ? 0.5 : 1}; font-size: 13px; font-weight: 500;`;
    },

    // =========================================================
    //  Live Metrics
    // =========================================================

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

    // =========================================================
    //  Display & Theme
    // =========================================================

    _renderDisplaySection(device, display) {
        const onOff = [['true', 'On'], ['false', 'Off']];
        return `
            <div class="section-header">Display & Theme</div>
            <div class="card"><div class="card-body"><div class="form-grid">
                ${this.settingSelect(device, 'display', 'preferences.theme',
                    'Theme', display['preferences.theme'] || 'default',
                    [['default', 'Default'], ['midnight', 'Midnight'], ['ocean', 'Ocean'], ['forest', 'Forest']])}
                ${this.settingSelect(device, 'display', 'preferences.themeMode',
                    'Mode', display['preferences.themeMode'] || 'system',
                    [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']])}
                ${this.settingSelect(device, 'display', 'preferences.layoutMode',
                    'Layout', display['preferences.layoutMode'] || 'widgets',
                    [['widgets', 'Widgets'], ['single-panel', 'Single Panel']])}
                ${this.settingSelect(device, 'display', 'preferences.dashboardZoom',
                    'Dashboard Zoom', String(display['preferences.dashboardZoom'] || 100),
                    [['80', '80%'], ['90', '90%'], ['100', '100%'], ['110', '110%'], ['120', '120%']])}
                ${this.settingSelect(device, 'display', 'preferences.sidebarIconSize',
                    'Sidebar Size', display['preferences.sidebarIconSize'] || 'medium',
                    [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}
                ${this.settingSelect(device, 'display', 'preferences.widgetFontSize',
                    'Widget Font Size', display['preferences.widgetFontSize'] || 'medium',
                    [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}
                ${this.settingSelect(device, 'display', 'preferences.calendarFontSize',
                    'Calendar Font Size', display['preferences.calendarFontSize'] || 'medium',
                    [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}
                ${this.settingSelect(device, 'display', 'preferences.animationLevel',
                    'Animation Level', String(display['preferences.animationLevel'] ?? 2),
                    [['0', 'None'], ['1', 'Subtle'], ['2', 'Standard'], ['3', 'Full']])}
                ${this.settingSelect(device, 'display', 'preferences.themeAnimationsEnabled',
                    'Theme Animations', String(display['preferences.themeAnimationsEnabled'] !== false),
                    onOff)}
                ${this.settingSelect(device, 'display', 'preferences.weatherOverlayEnabled',
                    'Weather Overlay', String(display['preferences.weatherOverlayEnabled'] !== false),
                    onOff)}
                ${this.settingSelect(device, 'display', 'preferences.orientationLock',
                    'Orientation', display['preferences.orientationLock'] || 'auto',
                    [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']])}
            </div></div></div>
        `;
    },

    // =========================================================
    //  Sleep & Screensaver
    // =========================================================

    _renderSleepSection(device, sleep) {
        const onOff = [['true', 'On'], ['false', 'Off']];
        const times = [
            ['20:00', '8:00 PM'], ['20:30', '8:30 PM'],
            ['21:00', '9:00 PM'], ['21:30', '9:30 PM'],
            ['22:00', '10:00 PM'], ['22:30', '10:30 PM'],
            ['23:00', '11:00 PM'], ['23:30', '11:30 PM'],
            ['00:00', '12:00 AM'],
        ];
        const wakeTimes = [
            ['05:00', '5:00 AM'], ['05:30', '5:30 AM'],
            ['06:00', '6:00 AM'], ['06:30', '6:30 AM'],
            ['07:00', '7:00 AM'], ['07:30', '7:30 AM'],
            ['08:00', '8:00 AM'], ['08:30', '8:30 AM'],
            ['09:00', '9:00 AM'],
        ];
        return `
            <div class="section-header">Sleep & Screensaver</div>
            <div class="card"><div class="card-body"><div class="form-grid">
                ${this.settingSelect(device, 'sleep', 'sleep.enabled',
                    'Sleep Timer', String(sleep['sleep.enabled'] !== false), onOff)}
                ${this.settingSelect(device, 'sleep', 'sleep.timerStart',
                    'Sleep Time', sleep['sleep.timerStart'] || '22:00', times)}
                ${this.settingSelect(device, 'sleep', 'sleep.timerEnd',
                    'Wake Time', sleep['sleep.timerEnd'] || '07:00', wakeTimes)}
                ${this.settingSelect(device, 'sleep', 'sleep.method',
                    'Sleep Method', sleep['sleep.method'] || 'power-off',
                    [['power-off', 'Power Off'], ['screen-off', 'Screen Off'], ['screensaver', 'Screensaver']])}
                ${this.settingSelect(device, 'sleep', 'sleep.resleepTimeout',
                    'Re-sleep Delay (min)', String(sleep['sleep.resleepTimeout'] ?? 15),
                    [['5', '5'], ['10', '10'], ['15', '15'], ['30', '30'], ['60', '60']])}
                ${this.settingSelect(device, 'sleep', 'sleep.inactivityTimeout',
                    'Inactivity Timeout (sec)', String(sleep['sleep.inactivityTimeout'] ?? 120),
                    [['30', '30'], ['60', '60'], ['120', '120'], ['300', '300'], ['600', '600']])}
                ${this.settingSelect(device, 'sleep', 'sleep.motionWakeForSleep',
                    'Wake on Motion', String(sleep['sleep.motionWakeForSleep'] !== false), onOff)}
                ${this.settingSelect(device, 'sleep', 'sleep.showClock',
                    'Show Clock in Sleep', String(sleep['sleep.showClock'] !== false), onOff)}
                ${this.settingSelect(device, 'sleep', 'sleep.reduceBrightnessOnSleep',
                    'Reduce Brightness', String(sleep['sleep.reduceBrightnessOnSleep'] !== false), onOff)}
            </div></div></div>
        `;
    },

    // =========================================================
    //  Voice & AI
    // =========================================================

    _renderVoiceSection(device, aiVoice, voice) {
        const onOff = [['true', 'On'], ['false', 'Off']];
        return `
            <div class="section-header">Voice & AI</div>
            <div class="card"><div class="card-body"><div class="form-grid">
                ${this.settingSelect(device, 'voice', 'voice.enabled',
                    'Voice Assistant', String(voice['voice.enabled'] !== false), onOff)}
                ${this.settingSelect(device, 'voice', 'voice.controlMethod',
                    'Control Method', voice['voice.controlMethod'] || 'wake-word',
                    [['wake-word', 'Wake Word'], ['hold', 'Hold to Talk']])}
                ${this.settingSelect(device, 'aiVoice', 'aiVoice.personality',
                    'AI Personality', aiVoice['aiVoice.personality'] || 'friendly',
                    [['friendly', 'Friendly'], ['calm', 'Calm'], ['professional', 'Professional'], ['playful', 'Playful']])}
                ${this.settingSelect(device, 'aiVoice', 'aiVoice.voice',
                    'Voice', aiVoice['aiVoice.voice'] || 'rachel',
                    [['rachel', 'Rachel'], ['adam', 'Adam'], ['aria', 'Aria'], ['thomas', 'Thomas'], ['jessica', 'Jessica']])}
                ${this.settingSelect(device, 'voice', 'voice.responseHandling',
                    'Response Output', voice['voice.responseHandling'] || 'both',
                    [['text-only', 'Text Only'], ['audio-only', 'Audio Only'], ['both', 'Text + Audio']])}
                ${this.settingSelect(device, 'voice', 'voice.displayFormat',
                    'Transcription Display', voice['voice.displayFormat'] || 'full',
                    [['full', 'Full'], ['concise', 'Concise'], ['none', 'Hidden']])}
            </div></div></div>
        `;
    },

    // =========================================================
    //  Photos / Slideshow
    // =========================================================

    _renderPhotosSection(device, photos) {
        const onOff = [['true', 'On'], ['false', 'Off']];
        return `
            <div class="section-header">Photos & Slideshow</div>
            <div class="card"><div class="card-body">
                <div class="form-grid">
                    ${this.settingSelect(device, 'photos', 'photos.slideshowInterval',
                        'Slideshow Interval (sec)', String(photos['photos.slideshowInterval'] ?? 30),
                        [['5', '5'], ['10', '10'], ['15', '15'], ['30', '30'], ['60', '60']])}
                    ${this.settingSelect(device, 'photos', 'photos.slideshowTransition',
                        'Transition', photos['photos.slideshowTransition'] || 'fade',
                        [['fade', 'Fade'], ['slide', 'Slide'], ['none', 'None']])}
                    ${this.settingSelect(device, 'photos', 'photos.slideshowShuffle',
                        'Shuffle', String(photos['photos.slideshowShuffle'] !== false), onOff)}
                    ${this.settingSelect(device, 'photos', 'photos.showMetadata',
                        'Show Metadata', String(photos['photos.showMetadata'] === true), onOff)}
                </div>
                <div style="margin-top: 12px; font-size: var(--font-size-sm); color: var(--text-muted);">
                    Manage albums and photo sources on the <a href="#photos" onclick="event.preventDefault(); App.navigate('photos')">Photos page</a>.
                </div>
            </div></div>
        `;
    },

    // =========================================================
    //  Device Behavior — HA switches not surfaced elsewhere
    // =========================================================

    _renderBehaviorSection(device, m) {
        const controls = m.controls || {};
        const switches = [
            { role: 'screensaver',            label: 'Screensaver',              description: 'Show photo slideshow during sleep' },
            { role: 'keep_screen_on',         label: 'Keep Screen On',           description: 'Prevent sleep while in use' },
            { role: 'auto_brightness',        label: 'Auto Brightness',          description: 'Adjust brightness based on ambient light' },
            { role: 'hide_sidebar',           label: 'Hide Sidebar',             description: 'Maximize widget area' },
            { role: 'hide_tabs',              label: 'Hide Tabs',                description: 'Remove dashboard tabs' },
            { role: 'start_on_boot',          label: 'Start on Boot',            description: 'Launch Dashie when the device powers on' },
            { role: 'camera_software_encoding', label: 'Camera Software Encoding', description: 'Use software codec (older devices)' },
        ].filter(s => controls[s.role] !== undefined);

        if (switches.length === 0) return '';
        const idAttr = DevicesPage._escape(device.device_id);
        const rows = switches.map(s => {
            const on = !!controls[s.role];
            const busy = !!DevicesCard._busyControl[`${device.device_id}:${s.role}`];
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border, #e5e7eb);">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 500;">${s.label}</div>
                        <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: 2px;">${s.description}</div>
                    </div>
                    <button title="${on ? 'On — tap to turn off' : 'Off — tap to turn on'}" ${busy ? 'disabled' : ''}
                        onclick="DevicesCard.toggleSwitch('${idAttr}', '${s.role}', ${on})"
                        style="${this._toggleSwitchStyle(on, busy)}">
                        <span style="${this._toggleKnobStyle(on)}"></span>
                    </button>
                </div>
            `;
        }).join('');
        return `
            <div class="section-header">Device Behavior</div>
            <div class="card"><div class="card-body" style="padding: 4px 16px;">
                ${rows}
            </div></div>
        `;
    },

    _toggleSwitchStyle(on, busy) {
        const bg = on ? '#10b981' : '#d1d5db';
        return `position: relative; width: 44px; height: 24px; border-radius: 999px; border: none; background: ${bg}; cursor: ${busy ? 'wait' : 'pointer'}; opacity: ${busy ? 0.5 : 1}; padding: 0; transition: background 0.15s;`;
    },

    _toggleKnobStyle(on) {
        return `position: absolute; top: 2px; left: ${on ? '22px' : '2px'}; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: left 0.15s;`;
    },

    // =========================================================
    //  Admin Actions — HA buttons (relaunch / refresh / reboot…)
    // =========================================================

    _renderAdminSection(device, m) {
        const controls = m.controls || {};
        const live = DevicesPage._isLive(device);
        // Each entry: role, label, description, destructive (confirm + red)
        const actions = [
            { role: 'refresh',             label: 'Refresh WebView',       description: 'Hard-refresh the dashboard' },
            { role: 'relaunch',            label: 'Relaunch App',          description: 'Restart Dashie on the device' },
            { role: 'bring_to_foreground', label: 'Bring to Foreground',   description: 'Pull Dashie back to the top' },
            { role: 'clear_cache',         label: 'Clear Cache',           description: 'Wipe cached data (logs in again)', destructive: true },
            { role: 'clear_storage',       label: 'Clear Storage',         description: 'Wipe all app data on this device', destructive: true },
            { role: 'reboot',              label: 'Reboot Device',         description: 'Restart the entire device', destructive: true },
        ];
        const idAttr = DevicesPage._escape(device.device_id);
        const rows = actions.map(a => {
            // If the device reports this button entity, show it; otherwise gray it out with a hint.
            const available = controls[a.role] !== undefined;
            const busy = !!DevicesCard._busyControl[`${device.device_id}:${a.role}`];
            const handlerName = a.destructive ? '_pressDestructive' : '_pressAdmin';
            const btnColor = a.destructive ? '#c00' : 'var(--text-primary)';
            const btnBorder = a.destructive ? '#fca5a5' : 'var(--border, #d1d5db)';
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border, #e5e7eb); ${!available || !live ? 'opacity: 0.5;' : ''}">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 500;">${a.label}</div>
                        <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: 2px;">${a.description}</div>
                    </div>
                    <button title="${available ? a.description : 'Not supported on this device'}"
                        ${!available || !live || busy ? 'disabled' : ''}
                        onclick="DevicesDetail.${handlerName}('${idAttr}', '${a.role}', '${DevicesPage._escape(a.label)}')"
                        style="padding: 6px 14px; border-radius: 6px; border: 1px solid ${btnBorder}; background: #fff; color: ${btnColor}; cursor: ${busy ? 'wait' : (available && live ? 'pointer' : 'not-allowed')}; font-size: 13px; font-weight: 500;">
                        ${busy ? 'Running…' : 'Run'}
                    </button>
                </div>
            `;
        }).join('');
        return `
            <div class="section-header">Admin Actions</div>
            <div class="card"><div class="card-body" style="padding: 4px 16px;">
                ${rows}
            </div></div>
        `;
    },

    /** Non-destructive admin actions — just call pressButton. */
    _pressAdmin(deviceId, role, label) {
        DevicesCard.pressButton(deviceId, role);
    },

    /** Destructive admin actions — confirm before firing. */
    async _pressDestructive(deviceId, role, label) {
        const confirmed = await ConfirmModal.confirm({
            title: `${label}?`,
            message: `Run "${label}" on this device? This action cannot be undone.`,
            confirmLabel: label,
            cancelLabel: 'Cancel',
            danger: true,
        });
        if (!confirmed) return;
        DevicesCard.pressButton(deviceId, role);
    },

    // =========================================================
    //  Danger Zone — soft + permanent delete
    // =========================================================

    _renderDangerZone(device) {
        const idAttr = DevicesPage._escape(device.device_id);
        const nameEsc = DevicesPage._escape(device.device_name || 'Device');
        return `
            <div class="section-header" style="color: var(--status-error, #c00); margin-top: 32px;">Danger Zone</div>
            <div class="card" style="border-color: var(--status-error, #c00);">
                <div class="card-body" style="padding: 4px 16px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border, #e5e7eb);">
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-weight: 500;">Remove from your account</div>
                            <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: 2px;">Soft delete — the device can re-register on next sign-in and reclaim its identity.</div>
                        </div>
                        <button onclick="DevicesDetail._softDelete('${idAttr}', '${nameEsc}')"
                            style="padding: 6px 14px; border-radius: 6px; border: 1px solid #fca5a5; background: #fff; color: #c00; cursor: pointer; font-size: 13px; font-weight: 500;">
                            Remove
                        </button>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0;">
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-weight: 500;">Permanently delete</div>
                            <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: 2px;">Hard delete — removes all device records and metrics. Cannot be undone.</div>
                        </div>
                        <button onclick="DevicesDetail._hardDelete('${idAttr}', '${nameEsc}')"
                            style="padding: 6px 14px; border-radius: 6px; border: none; background: #c00; color: #fff; cursor: pointer; font-size: 13px; font-weight: 500;">
                            Delete Forever
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    async _softDelete(deviceId, deviceName) {
        const confirmed = await ConfirmModal.confirm({
            title: 'Remove device?',
            message: `Remove "${deviceName}" from your account?\n\nThe device can re-register on next sign-in.`,
            confirmLabel: 'Remove',
            cancelLabel: 'Cancel',
            danger: true,
        });
        if (!confirmed) return;
        try {
            await DashieAuth.dbRequest('delete_device', { device_id: deviceId });
            DevicesPage._devices = (DevicesPage._devices || []).filter(d => d.device_id !== deviceId);
            DevicesPage._detailDeviceId = null;
            Toast.success(`Removed "${deviceName}"`);
            App.renderPage();
        } catch (e) {
            console.error('[DevicesDetail] soft delete failed:', e);
            Toast.error(Toast.friendly(e, 'remove this device'));
        }
    },

    async _hardDelete(deviceId, deviceName) {
        const confirmed = await ConfirmModal.confirm({
            title: 'Permanently delete this device?',
            message: `This permanently deletes "${deviceName}" and all of its metrics, settings, and history.\n\nThis cannot be undone.`,
            confirmLabel: 'Delete Forever',
            cancelLabel: 'Cancel',
            danger: true,
            requireTypedConfirmation: deviceName,
            typedConfirmationLabel: `Type "${deviceName}" to confirm`,
        });
        if (!confirmed) return;
        try {
            await DashieAuth.dbRequest('delete_device', { device_id: deviceId, hard_delete: true });
            DevicesPage._devices = (DevicesPage._devices || []).filter(d => d.device_id !== deviceId);
            DevicesPage._detailDeviceId = null;
            Toast.success(`Deleted "${deviceName}" permanently`);
            App.renderPage();
        } catch (e) {
            console.error('[DevicesDetail] hard delete failed:', e);
            Toast.error(Toast.friendly(e, 'permanently delete this device'));
        }
    },

    // =========================================================
    //  Generic dropdown — used by every settings section above.
    //  Persists via DevicesPage._onSettingChange → update_device_settings.
    // =========================================================

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
