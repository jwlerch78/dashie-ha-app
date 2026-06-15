/* ============================================================
   Devices Detail — Display section body + modals
   ------------------------------------------------------------
   Mirrors the Kotlin DisplayPageSchema: three sub-section cards
   (Dashboard / Screen Management / Display Preferences) each
   containing summary-rows. Click → modal in this file. Inline
   toggles (Animations, Auto Brightness) skip the modal layer.

   Modal taxonomy:
     - Sleep modal: composite (mode + schedule + inactivity + options)
     - Theme modal: theme family + dark mode
     - Screensaver modal: timeout + mode + per-mode options
     - Picker modal: generic single-setting picker, reused for
       Layout / Orientation / Animation Level / Wake Mode / Zooms /
       Sidebar Icon Size / Screen Off Behavior

   Persistence: every write goes through DevicesPage._onSettingChange,
   same broadcast path the inline form-grid used to use.
   ============================================================ */

const DevicesDetailModals = {

    // ── Option catalogs (mirror Kotlin DisplayPageSchema) ──────

    LAYOUT_MODES: [
        ['widgets', 'Widgets'],
        ['single_panel', 'Single Panel'],
        ['kiosk', 'Kiosk mode (HA-only)'],
    ],

    ORIENTATION_MODES: [
        ['auto', 'Auto'],
        ['landscape', 'Landscape'],
        ['landscape_reverse', 'Landscape (reversed)'],
        ['portrait', 'Portrait'],
        ['portrait_reverse', 'Portrait (reversed)'],
    ],

    THEME_FAMILIES: [
        ['default', 'Default'],
        ['blue', 'Blue'],
        ['halloween', 'Halloween'],
        ['christmas', 'Christmas'],
    ],

    ANIMATION_LEVELS: [
        ['high', 'High'],
        ['low', 'Low'],
    ],

    WAKE_MODES: [
        ['disabled', 'Touch Only'],
        ['brightness', 'Brightness Sensor'],
        ['camera', 'Motion (Camera)'],
        ['face', 'Face Detection (Camera)'],
    ],

    ZOOM_LEVELS: [
        ['50', '50%'], ['75', '75%'], ['90', '90%'], ['100', '100%'],
        ['110', '110%'], ['125', '125%'], ['150', '150%'],
        ['175', '175%'], ['200', '200%'],
    ],

    SIDEBAR_ICON_SIZES: [
        ['0.75', 'Very Small'],
        ['0.9', 'Small'],
        ['1', 'Medium'],
        ['1.15', 'Large'],
        ['1.3', 'Extra Large'],
    ],

    SCREEN_OFF_BEHAVIORS: [
        ['black_overlay', 'Black Overlay'],
        ['power_off', 'Power Off Screen'],
    ],

    SCREENSAVER_TIMEOUTS: [
        ['0', 'Off'], ['10', '10 sec'], ['30', '30 sec'],
        ['60', '1 min'], ['120', '2 min'], ['300', '5 min'],
        ['600', '10 min'], ['1800', '30 min'],
    ],

    SCREENSAVER_MODES: [
        ['dim', 'Dim'],
        ['black', 'Black Overlay'],
        ['off', 'Screen Off'],
        ['photos', 'Photos'],
        ['weather', 'Weather & Time'],
    ],

    // ── Section body ──────────────────────────────────────────

    renderDisplayBody(device, display, sleep) {
        const idAttr = DevicesPage._escape(device.device_id);
        const sleepSummary = this.buildSleepSummary(sleep, display);
        const themeSummary = this.buildThemeSummary(display);
        const animationsOn = display.animationsEnabled === true || display['display.animationsEnabled'] === true;
        const themeFamily = display.themeFamily || 'default';
        const layoutMode = display.layoutMode || display['preferences.layoutMode'] || 'widgets';
        const showOrientation = layoutMode === 'widgets';
        const showAnimationRows = themeFamily !== 'default';

        return `
            ${this._subsectionCard('Dashboard', [
                this._summaryRow('Layout', this._labelFor(this.LAYOUT_MODES, layoutMode),
                    `DevicesDetailModals.openPicker('${idAttr}','display','layoutMode','Layout','LAYOUT_MODES')`),
                showOrientation ? this._summaryRow('Orientation',
                    this._labelFor(this.ORIENTATION_MODES, display.orientationLock || 'auto'),
                    `DevicesDetailModals.openPicker('${idAttr}','display','orientationLock','Orientation','ORIENTATION_MODES')`) : '',
                this._summaryRow('Theme', themeSummary,
                    `DevicesDetailModals.openTheme('${idAttr}')`),
                showAnimationRows ? this._toggleRow(device, 'display', 'animationsEnabled',
                    'Animations', animationsOn) : '',
                showAnimationRows && animationsOn ? this._summaryRow('Animation Level',
                    this._labelFor(this.ANIMATION_LEVELS, display.animationLevel || display['preferences.animationLevel'] || 'high'),
                    `DevicesDetailModals.openPicker('${idAttr}','display','animationLevel','Animation Level','ANIMATION_LEVELS')`) : '',
            ].filter(Boolean).join(''))}
            ${this._subsectionCard('Screen Management', [
                this._summaryRow('Sleep Mode', sleepSummary,
                    `DevicesDetailModals.openSleep('${idAttr}')`),
                this._summaryRow('Screensaver', this.buildScreensaverSummary(display),
                    `DevicesDetailModals.openScreensaver('${idAttr}')`),
                this._summaryRow('Wake Mode',
                    this._labelFor(this.WAKE_MODES, display.motionWakeMode || 'disabled'),
                    `DevicesDetailModals.openPicker('${idAttr}','display','motionWakeMode','Wake Mode','WAKE_MODES')`),
            ].join(''))}
            ${this._subsectionCard('Display Preferences', [
                this._summaryRow('HA Dashboard Zoom',
                    this._labelFor(this.ZOOM_LEVELS, String(display.dashboardZoom ?? '100')) + '',
                    `DevicesDetailModals.openPicker('${idAttr}','display','dashboardZoom','HA Dashboard Zoom','ZOOM_LEVELS')`),
                this._summaryRow('Widget Zoom',
                    this._labelFor(this.ZOOM_LEVELS, String(display.widgetZoom ?? '100')),
                    `DevicesDetailModals.openPicker('${idAttr}','display','widgetZoom','Widget Zoom','ZOOM_LEVELS')`),
                this._summaryRow('Sidebar Icon Size',
                    this._labelFor(this.SIDEBAR_ICON_SIZES, String(display.sidebarIconSize ?? '1')),
                    `DevicesDetailModals.openPicker('${idAttr}','display','sidebarIconSize','Sidebar Icon Size','SIDEBAR_ICON_SIZES')`),
                this._summaryRow('Screen Off Behavior',
                    this._labelFor(this.SCREEN_OFF_BEHAVIORS, display.screenOffBehavior || 'black_overlay'),
                    `DevicesDetailModals.openPicker('${idAttr}','display','screenOffBehavior','Screen Off Behavior','SCREEN_OFF_BEHAVIORS')`),
                this._toggleRow(device, 'display', 'autoBrightnessEnabled',
                    'Auto Brightness', display.autoBrightnessEnabled === true),
            ].join(''))}
        `;
    },

    _subsectionCard(title, rowsHtml) {
        return `
            <div class="card" style="margin-bottom: 12px;">
                <div class="card-body" style="padding: 0;">
                    <div style="padding: 12px 16px 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">${this._escape(title)}</div>
                    ${rowsHtml}
                </div>
            </div>
        `;
    },

    _summaryRow(label, summary, onClick) {
        return `
            <div onclick="${onClick}" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; cursor: pointer; gap: 12px; border-top: 1px solid var(--border-subtle);"
                onmouseenter="this.style.background='var(--bg-subtle, #f3f4f6)'" onmouseleave="this.style.background='transparent'">
                <span style="font-size: var(--font-size-sm); font-weight: 500;">${this._escape(label)}</span>
                <span style="display: inline-flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: var(--font-size-sm); text-align: right;">
                    ${this._escape(summary)}
                    <span style="color: var(--text-muted); font-size: 14px;">›</span>
                </span>
            </div>
        `;
    },

    _toggleRow(device, category, key, label, checked) {
        return `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-top: 1px solid var(--border-subtle);">
                <span style="font-size: var(--font-size-sm); font-weight: 500;">${this._escape(label)}</span>
                <label class="toggle">
                    <input type="checkbox" ${checked ? 'checked' : ''}
                        onchange="DevicesPage._onSettingChange('${device.device_id}', '${category}', '${key}', this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </div>
        `;
    },

    /** External call kept for any leftover callers (kept stable across refactors). */
    renderSummaryRow(label, summary, onClick) { return this._summaryRow(label, summary, onClick); },

    // ── Summary builders (mirror Kotlin control center) ────────

    /** "22:00 / 07:00 (Black Overlay)" / "2 min timeout (Black Overlay)" / "Inactive" */
    buildSleepSummary(sleep, display) {
        const enabled = sleep['sleep.enabled'] !== false && sleep['sleep.sleepMode'] !== 'off';
        if (!enabled) return 'Inactive';
        const method = sleep['sleep.method'] || sleep['sleep.sleepMode'] || 'schedule';
        let timeStr;
        if (method === 'inactivity') {
            const seconds = Number(sleep['sleep.inactivityTimeout'] ?? 120);
            timeStr = `${this._formatTimeout(seconds)} timeout`;
        } else {
            const start = sleep['sleep.timerStart'] || sleep['sleep.sleepTime'] || '22:00';
            const end = sleep['sleep.timerEnd'] || sleep['sleep.wakeTime'] || '07:00';
            timeStr = `${this._formatTime(start)} / ${this._formatTime(end)}`;
        }
        const screenOff = (display && (display.screenOffBehavior || display['display.screenOffBehavior'])) || 'black_overlay';
        const offLabel = screenOff === 'power_off' ? 'Power Off' : 'Black Overlay';
        return `${timeStr} (${offLabel})`;
    },

    /** "Default · Dark" — theme family + dark mode. */
    buildThemeSummary(display) {
        const fam = display.themeFamily || 'default';
        const famLabel = this._labelFor(this.THEME_FAMILIES, fam);
        const darkMode = display.darkMode === true || display.themeMode === 'dark';
        return `${famLabel} · ${darkMode ? 'Dark' : 'Light'}`;
    },

    /** "Photos, 5 min" / "Off" / "{Mode} ({timeout})" */
    buildScreensaverSummary(display) {
        const timeout = Number(display.screensaverTimeout ?? display['screensaver.timeout'] ?? 0);
        if (!timeout) return 'Off';
        const mode = display.screensaverMode || display['screensaver.mode'] || 'dim';
        const modeLabel = this._labelFor(this.SCREENSAVER_MODES, mode);
        return `${modeLabel}, ${this._formatTimeout(timeout)}`;
    },

    // ── Sleep modal ────────────────────────────────────────────

    _sleepOpen: false,
    _sleepDeviceId: null,

    openSleep(deviceId) { this._sleepOpen = true; this._sleepDeviceId = deviceId; App.renderPage(); },
    closeSleep() { this._sleepOpen = false; this._sleepDeviceId = null; App.renderPage(); },

    renderSleepModal() {
        if (!this._sleepOpen) return '';
        const device = DevicesPage._findDevice(this._sleepDeviceId);
        if (!device) return '';
        const sleep = device.settings?.sleep || {};
        const display = device.settings?.display || {};

        const enabled = sleep['sleep.enabled'] !== false;
        const method = sleep['sleep.method'] || 'schedule';
        const sleepMode = !enabled ? 'off' : method;
        const scheduleVisible = sleepMode === 'schedule';
        const inactivityVisible = sleepMode === 'inactivity';
        const optionsVisible = sleepMode !== 'off';
        const screenOff = display['display.screenOffBehavior'] || display.screenOffBehavior || 'black_overlay';
        const notPowerOff = screenOff !== 'power_off';

        const D = DevicesDetail;
        const body = `
            <div style="display: flex; flex-direction: column; gap: 14px;">
                <div class="form-group">
                    <label class="form-label">Sleep Mode</label>
                    ${D._settingSelectRaw(device, 'sleep', 'sleep.sleepMode', sleepMode, [
                        ['off', 'Off'], ['schedule', 'Schedule'], ['inactivity', 'Timeout']
                    ], 'DevicesDetailModals._onSleepModeChange(this.value)')}
                </div>
                ${scheduleVisible ? `
                    ${this._divider('Schedule')}
                    ${D.settingSelect(device, 'sleep', 'sleep.timerStart',
                        'Sleep Time', sleep['sleep.timerStart'] || '22:00', OptionCatalog.sleepTimes())}
                    ${D.settingSelect(device, 'sleep', 'sleep.timerEnd',
                        'Wake Time', sleep['sleep.timerEnd'] || '07:00', OptionCatalog.wakeTimes())}
                    ${D.settingSelect(device, 'sleep', 'sleep.resleepTimeout',
                        'Re-sleep Delay (min)', String(sleep['sleep.resleepTimeout'] ?? 15), OptionCatalog.resleepDelays())}
                ` : ''}
                ${inactivityVisible ? `
                    ${this._divider('Inactivity')}
                    ${D.settingSelect(device, 'sleep', 'sleep.inactivityTimeout',
                        'Sleep After (sec)', String(sleep['sleep.inactivityTimeout'] ?? 120), OptionCatalog.inactivityTimeouts())}
                ` : ''}
                ${optionsVisible ? `
                    ${this._divider('Options')}
                    ${D._settingSelectRaw(device, 'display', 'screenOffBehavior', screenOff, this.SCREEN_OFF_BEHAVIORS)}
                    ${notPowerOff ? `
                        ${D._settingToggleRow(device, 'sleep', 'sleep.sleepShowClock',
                            'Show Clock During Sleep', sleep['sleep.sleepShowClock'] === true)}
                        ${D._settingToggleRow(device, 'sleep', 'sleep.reduceBrightnessOnSleep',
                            'Reduce Brightness While Asleep', sleep['sleep.reduceBrightnessOnSleep'] === true)}
                    ` : ''}
                    ${D._settingToggleRow(device, 'sleep', 'sleep.motionWakeForSleep',
                        'Motion Wake', sleep['sleep.motionWakeForSleep'] === true)}
                ` : ''}
            </div>
        `;
        return this._modal('Sleep / Wake', body, 'DevicesDetailModals.closeSleep()');
    },

    _onSleepModeChange(value) {
        const device = DevicesPage._findDevice(this._sleepDeviceId);
        if (!device) return;
        const enabled = value !== 'off';
        const method = value === 'off' ? (device.settings?.sleep?.['sleep.method'] || 'schedule') : value;
        DevicesPage._onSettingChange(device.device_id, 'sleep', 'sleep.enabled', enabled);
        DevicesPage._onSettingChange(device.device_id, 'sleep', 'sleep.method', method);
        DevicesPage._onSettingChange(device.device_id, 'sleep', 'sleep.sleepMode', value);
    },

    // ── Theme modal (family + dark mode) ──────────────────────

    _themeOpen: false,
    _themeDeviceId: null,

    openTheme(deviceId) { this._themeOpen = true; this._themeDeviceId = deviceId; App.renderPage(); },
    closeTheme() { this._themeOpen = false; this._themeDeviceId = null; App.renderPage(); },

    renderThemeModal() {
        if (!this._themeOpen) return '';
        const device = DevicesPage._findDevice(this._themeDeviceId);
        if (!device) return '';
        const display = device.settings?.display || {};
        const D = DevicesDetail;
        const darkMode = display.darkMode === true || display.themeMode === 'dark';
        const body = `
            <div style="display: flex; flex-direction: column; gap: 14px;">
                <div class="form-group">
                    <label class="form-label">Theme</label>
                    ${D._settingSelectRaw(device, 'display', 'themeFamily',
                        display.themeFamily || 'default', this.THEME_FAMILIES)}
                </div>
                ${D._settingToggleRow(device, 'display', 'darkMode', 'Dark Mode', darkMode)}
                <div style="font-size: var(--font-size-sm); color: var(--text-muted);">
                    Seasonal themes (Halloween, Christmas) auto-activate during their respective months.
                </div>
            </div>
        `;
        return this._modal('Theme', body, 'DevicesDetailModals.closeTheme()');
    },

    // ── Generic single-picker modal ───────────────────────────

    _pickerOpen: false,
    _pickerCtx: null,  // {deviceId, category, key, label, optionsCatalogKey}

    openPicker(deviceId, category, key, label, optionsCatalogKey) {
        this._pickerOpen = true;
        this._pickerCtx = { deviceId, category, key, label, optionsCatalogKey };
        App.renderPage();
    },
    closePicker() { this._pickerOpen = false; this._pickerCtx = null; App.renderPage(); },

    renderPickerModal() {
        if (!this._pickerOpen) return '';
        const ctx = this._pickerCtx;
        const device = DevicesPage._findDevice(ctx.deviceId);
        if (!device) return '';
        const options = this[ctx.optionsCatalogKey] || [];
        const current = device.settings?.[ctx.category]?.[ctx.key] ?? options[0]?.[0];
        const body = `
            <div class="form-group">
                <label class="form-label">${this._escape(ctx.label)}</label>
                ${DevicesDetail._settingSelectRaw(device, ctx.category, ctx.key, String(current), options)}
            </div>
        `;
        return this._modal(ctx.label, body, 'DevicesDetailModals.closePicker()');
    },

    // ── Screensaver modal ─────────────────────────────────────

    _screensaverOpen: false,
    _screensaverDeviceId: null,

    openScreensaver(deviceId) { this._screensaverOpen = true; this._screensaverDeviceId = deviceId; App.renderPage(); },
    closeScreensaver() { this._screensaverOpen = false; this._screensaverDeviceId = null; App.renderPage(); },

    renderScreensaverModal() {
        if (!this._screensaverOpen) return '';
        const device = DevicesPage._findDevice(this._screensaverDeviceId);
        if (!device) return '';
        const display = device.settings?.display || {};
        const timeout = String(display.screensaverTimeout ?? '0');
        const mode = display.screensaverMode || 'dim';
        const D = DevicesDetail;
        const enabled = timeout !== '0';
        const showClock = display.screensaverShowClock === true;
        const body = `
            <div style="display: flex; flex-direction: column; gap: 14px;">
                <div class="form-group">
                    <label class="form-label">Timeout</label>
                    ${D._settingSelectRaw(device, 'display', 'screensaverTimeout', timeout, this.SCREENSAVER_TIMEOUTS)}
                </div>
                ${enabled ? `
                    <div class="form-group">
                        <label class="form-label">Mode</label>
                        ${D._settingSelectRaw(device, 'display', 'screensaverMode', mode, this.SCREENSAVER_MODES)}
                    </div>
                    ${(mode === 'dim' || mode === 'black' || mode === 'photos') ? `
                        ${D._settingToggleRow(device, 'display', 'screensaverShowClock', 'Show Clock', showClock)}
                        ${showClock ? D._settingToggleRow(device, 'display', 'screensaverShowDate',
                            'Show Date', display.screensaverShowDate === true) : ''}
                    ` : ''}
                ` : ''}
            </div>
        `;
        return this._modal('Screensaver', body, 'DevicesDetailModals.closeScreensaver()');
    },

    // ── Modal shell + helpers ─────────────────────────────────

    _modal(title, bodyHtml, onClose) {
        return `
            <div class="modal-backdrop" onclick="DevicesDetailModals._onBackdrop(event, '${onClose}')">
                <div class="modal" style="max-width: 480px; width: 92vw;">
                    <div class="modal-header">
                        <span class="modal-title">${this._escape(title)}</span>
                        <button class="modal-close" onclick="${onClose}">✕</button>
                    </div>
                    <div class="modal-body">${bodyHtml}</div>
                </div>
            </div>
        `;
    },

    _onBackdrop(event, onClose) {
        if (event.target.classList.contains('modal-backdrop')) {
            // eslint-disable-next-line no-new-func
            new Function(onClose)();
        }
    },

    _divider(label) {
        return `<div style="margin: 4px 0 -4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">${this._escape(label)}</div>`;
    },

    _labelFor(options, value) {
        const v = String(value);
        const found = options.find(([val]) => String(val) === v);
        return found ? found[1] : v;
    },

    _formatTimeout(seconds) {
        if (!isFinite(seconds) || seconds <= 0) return '0 sec';
        if (seconds < 60) return `${seconds} sec`;
        if (seconds < 3600) {
            const m = Math.round(seconds / 60);
            return m === 1 ? '1 min' : `${m} min`;
        }
        const h = Math.round(seconds / 3600 * 10) / 10;
        return h === 1 ? '1 hour' : `${h} hours`;
    },

    /** "22:00" → "10:00pm" (lowercased am/pm to match Kotlin look). */
    _formatTime(hhmm) {
        if (!hhmm || typeof hhmm !== 'string') return hhmm || '—';
        const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
        if (!m) return hhmm;
        let h = parseInt(m[1], 10);
        const mm = m[2];
        const period = h < 12 ? 'am' : 'pm';
        if (h === 0) h = 12;
        else if (h > 12) h -= 12;
        return `${h}:${mm}${period}`;
    },

    _escape(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
};

window.DevicesDetailModals = DevicesDetailModals;
