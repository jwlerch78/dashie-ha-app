/* ============================================================
   Devices Detail — Display section body + modals
   ------------------------------------------------------------
   Mirrors the Kotlin DisplayPageSchema: three sub-section cards
   (Dashboard / Screen Management / Display Preferences) each
   containing summary-rows. Click → modal in this file. Inline
   toggles (Animations) skip the modal layer.

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

    // Mirror Kotlin DisplayPageSchema displaySizeSubScreen — scales
    // native chrome (sidebar, control center, music/video/voice cards).
    DISPLAY_SIZES: [
        ['100', '100%'], ['125', '125%'], ['150', '150%'],
        ['175', '175%'], ['200', '200%'],
    ],

    // Mirror Kotlin DisplayPageSchema font_size_picker — scales widget text.
    FONT_SIZES: [
        ['75', '75%'], ['100', '100%'], ['125', '125%'], ['150', '150%'],
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

    // Mirror Kotlin WakeWordModel.BUNDLED_MODEL_IDS — keep these ids in
    // sync with the persisted format the Android side reads/writes.
    WAKE_WORDS: [
        ['hey_dashie', 'Hey Dashie'],
        ['mww_okay_nabu', 'Okay Nabu'],
        ['mww_hey_jarvis', 'Hey Jarvis'],
        ['mww_hey_mycroft', 'Hey Mycroft'],
        ['mww_alexa', 'Alexa'],
    ],

    // ── Account-settings cache (for ai.wakeWord and other account-wide
    //    fields we surface read/edit from the device detail page) ─────

    _accountSettings: null,     // populated by ensureAccountSettings()
    _accountLoading: false,

    /** Lazy-load user_settings the first time something on this page needs
     *  an account-level field. Re-render when the load resolves so the
     *  Voice section's Wake Word row swaps from "—" to the real value. */
    ensureAccountSettings() {
        if (this._accountSettings || this._accountLoading) return;
        this._accountLoading = true;
        DashieAuth.loadUserSettings().then(s => {
            this._accountSettings = s || {};
            this._accountLoading = false;
            App.renderPage();
        }).catch(() => {
            this._accountSettings = {};
            this._accountLoading = false;
        });
    },

    getAccountWakeWord() {
        return this._accountSettings?.ai?.wakeWord || '';
    },

    // ── Section body ──────────────────────────────────────────

    renderDisplayBody(device, display, sleep) {
        const idAttr = DevicesPage._escape(device.device_id);
        const screensaver = device.settings?.screensaver || {};
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
                    `DevicesDetailModals.openPicker('${idAttr}','display','layoutMode','Layout','LAYOUT_MODES','widgets')`),
                showOrientation ? this._summaryRow('Orientation',
                    this._labelFor(this.ORIENTATION_MODES, display.orientationLock || 'auto'),
                    `DevicesDetailModals.openPicker('${idAttr}','display','orientationLock','Orientation','ORIENTATION_MODES','auto')`) : '',
                this._summaryRow('Theme', themeSummary,
                    `DevicesDetailModals.openTheme('${idAttr}')`),
                showAnimationRows ? this._toggleRow(device, 'display', 'animationsEnabled',
                    'Animations', animationsOn) : '',
                showAnimationRows && animationsOn ? this._summaryRow('Animation Level',
                    this._labelFor(this.ANIMATION_LEVELS, display.animationLevel || display['preferences.animationLevel'] || 'high'),
                    `DevicesDetailModals.openPicker('${idAttr}','display','animationLevel','Animation Level','ANIMATION_LEVELS','high')`) : '',
            ].filter(Boolean).join(''))}
            ${this._subsectionCard('Screen Management', [
                this._summaryRow('Sleep Mode', sleepSummary,
                    `DevicesDetailModals.openSleep('${idAttr}')`),
                this._summaryRow('Screensaver', this.buildScreensaverSummary(display, screensaver),
                    `DevicesDetailModals.openScreensaver('${idAttr}')`),
                this._summaryRow('Wake Mode',
                    this._labelFor(this.WAKE_MODES, display.motionWakeMode || 'disabled'),
                    `DevicesDetailModals.openPicker('${idAttr}','display','motionWakeMode','Wake Mode','WAKE_MODES','disabled')`),
                // Granular Display Preferences (zooms, display/font size,
                // sidebar icon size, screen-off, auto brightness) collapse
                // into one row → modal. Summary text intentionally blank
                // — the modal has six+ values and surfacing any subset on
                // the row was just noise the user has to parse.
                this._summaryRow('Advanced Display Options', '',
                    `DevicesDetailModals.openAdvancedDisplay('${idAttr}')`),
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

    /** Just the theme family — dark/light is its own toggle inside the
     *  Theme modal, surfacing it here doubles up the same control. */
    buildThemeSummary(display) {
        const fam = display.themeFamily || 'default';
        return this._labelFor(this.THEME_FAMILIES, fam);
    },

    /** "Photos, 5 min" / "Off" / "{Mode} ({timeout})"
     *  Reads from user_devices.settings.screensaver.* (the canonical shape
     *  written by device-registration.js _buildScreensaverSettings), falling
     *  back to legacy display.screensaverX paths if the device hasn't yet
     *  written the new category. */
    buildScreensaverSummary(display, screensaver) {
        const s = screensaver || {};
        const timeout = Number(s.timeout ?? display?.screensaverTimeout ?? display?.['screensaver.timeout'] ?? 0);
        if (!timeout) return 'Off';
        const mode = s.mode || display?.screensaverMode || display?.['screensaver.mode'] || 'dim';
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

    openPicker(deviceId, category, key, label, optionsCatalogKey, defaultValue) {
        this._pickerOpen = true;
        this._pickerCtx = { deviceId, category, key, label, optionsCatalogKey, defaultValue };
        App.renderPage();
    },
    closePicker() { this._pickerOpen = false; this._pickerCtx = null; App.renderPage(); },

    renderPickerModal() {
        if (!this._pickerOpen) return '';
        const ctx = this._pickerCtx;
        const device = DevicesPage._findDevice(ctx.deviceId);
        if (!device) return '';
        const options = this[ctx.optionsCatalogKey] || [];
        // Default chain: stored value → caller-supplied default → first
        // option. Falling all the way through to options[0] is what made
        // Widget Zoom show "50%" when the device hadn't yet broadcast
        // a value — callers should pass an explicit defaultValue.
        const stored = device.settings?.[ctx.category]?.[ctx.key];
        const current = (stored != null && stored !== '') ? stored
            : (ctx.defaultValue != null ? ctx.defaultValue
            : options[0]?.[0]);
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
        const s = device.settings?.screensaver || {};
        const display = device.settings?.display || {};
        const timeout = String(s.timeout ?? display.screensaverTimeout ?? '0');
        const mode = s.mode || display.screensaverMode || 'dim';
        const D = DevicesDetail;
        const enabled = timeout !== '0';
        const showClock = s.showClock === true;
        const body = `
            <div style="display: flex; flex-direction: column; gap: 14px;">
                <div class="form-group">
                    <label class="form-label">Timeout</label>
                    ${D._settingSelectRaw(device, 'screensaver', 'timeout', timeout, this.SCREENSAVER_TIMEOUTS)}
                </div>
                ${enabled ? `
                    <div class="form-group">
                        <label class="form-label">Mode</label>
                        ${D._settingSelectRaw(device, 'screensaver', 'mode', mode, this.SCREENSAVER_MODES)}
                    </div>
                    ${(mode === 'dim' || mode === 'black' || mode === 'photos') ? `
                        ${D._settingToggleRow(device, 'screensaver', 'showClock', 'Show Clock', showClock)}
                        ${showClock ? D._settingToggleRow(device, 'screensaver', 'showDate',
                            'Show Date', s.showDate === true) : ''}
                    ` : ''}
                ` : ''}
            </div>
        `;
        return this._modal('Screensaver', body, 'DevicesDetailModals.closeScreensaver()');
    },

    // ── Advanced Display Options modal ────────────────────────

    _advancedDisplayOpen: false,
    _advancedDisplayDeviceId: null,

    openAdvancedDisplay(deviceId) {
        this._advancedDisplayOpen = true;
        this._advancedDisplayDeviceId = deviceId;
        App.renderPage();
    },
    closeAdvancedDisplay() {
        this._advancedDisplayOpen = false;
        this._advancedDisplayDeviceId = null;
        App.renderPage();
    },

    /** "100% / 100% · Medium" — most-glanceable values for the row. */
    _buildAdvancedDisplaySummary(display) {
        const ds = String(display.displaySize ?? '100');
        const fs = String(display.widgetFontSize ?? '100');
        const sis = this._labelFor(this.SIDEBAR_ICON_SIZES, String(display.sidebarIconSize ?? '1'));
        return `${ds}% / ${fs}% · ${sis}`;
    },

    renderAdvancedDisplayModal() {
        if (!this._advancedDisplayOpen) return '';
        const device = DevicesPage._findDevice(this._advancedDisplayDeviceId);
        if (!device) return '';
        const display = device.settings?.display || {};
        const D = DevicesDetail;
        const body = `
            <div style="display: flex; flex-direction: column; gap: 14px;">
                <div class="form-group">
                    <label class="form-label">Display Size</label>
                    ${D._settingSelectRaw(device, 'display', 'displaySize',
                        String(display.displaySize ?? '100'), this.DISPLAY_SIZES)}
                </div>
                <div class="form-group">
                    <label class="form-label">Font Size</label>
                    ${D._settingSelectRaw(device, 'display', 'widgetFontSize',
                        String(display.widgetFontSize ?? '100'), this.FONT_SIZES)}
                </div>
                <div class="form-group">
                    <label class="form-label">HA Dashboard Zoom</label>
                    ${D._settingSelectRaw(device, 'display', 'dashboardZoom',
                        String(display.dashboardZoom ?? '100'), this.ZOOM_LEVELS)}
                </div>
                <div class="form-group">
                    <label class="form-label">Widget Zoom</label>
                    ${D._settingSelectRaw(device, 'display', 'widgetZoom',
                        String(display.widgetZoom ?? '100'), this.ZOOM_LEVELS)}
                </div>
                <div class="form-group">
                    <label class="form-label">Sidebar Icon Size</label>
                    ${D._settingSelectRaw(device, 'display', 'sidebarIconSize',
                        String(display.sidebarIconSize ?? '1'), this.SIDEBAR_ICON_SIZES)}
                </div>
                <div class="form-group">
                    <label class="form-label">Screen Off Behavior</label>
                    ${D._settingSelectRaw(device, 'display', 'screenOffBehavior',
                        display.screenOffBehavior || 'black_overlay', this.SCREEN_OFF_BEHAVIORS)}
                </div>
                ${D._settingToggleRow(device, 'display', 'autoBrightnessEnabled',
                    'Auto Brightness', display.autoBrightnessEnabled === true)}
            </div>
        `;
        return this._modal('Advanced Display Options', body, 'DevicesDetailModals.closeAdvancedDisplay()');
    },

    // ── Wake Word modal (account-level user_settings.ai.wakeWord) ──

    _wakeWordOpen: false,
    _wakeWordSaving: false,
    _wakeWordPending: null,  // value chosen but not yet persisted

    openWakeWord() {
        this._wakeWordOpen = true;
        this._wakeWordPending = null;
        // Make sure cache is hot — needed for the picker's current value.
        if (!this._accountSettings) this.ensureAccountSettings();
        App.renderPage();
    },

    closeWakeWord() {
        this._wakeWordOpen = false;
        this._wakeWordPending = null;
        App.renderPage();
    },

    _setWakeWordPending(value) { this._wakeWordPending = value; },

    async submitWakeWord() {
        if (this._wakeWordSaving) return;
        const value = this._wakeWordPending;
        if (!value) { this.closeWakeWord(); return; }
        this._wakeWordSaving = true;
        App.renderPage();
        try {
            // Round-trip the full user_settings JSON (same shape Preferences
            // page uses). Refetch first to merge a fresh copy so we don't
            // clobber a category another tab/device wrote between our cache
            // load and this save.
            const remote = (await DashieAuth.loadUserSettings()) || {};
            const merged = { ...remote, ai: { ...(remote.ai || {}), wakeWord: value } };
            await DashieAuth.saveUserSettings(merged);
            this._accountSettings = merged;
            Toast.success('Wake word updated');
            this.closeWakeWord();
        } catch (e) {
            Toast.error(`Save failed: ${e?.message || e}`);
        } finally {
            this._wakeWordSaving = false;
            App.renderPage();
        }
    },

    renderWakeWordModal() {
        if (!this._wakeWordOpen) return '';
        const current = this._wakeWordPending != null
            ? this._wakeWordPending
            : (this.getAccountWakeWord() || 'hey_dashie');
        const optionsHtml = this.WAKE_WORDS.map(([val, label]) =>
            `<option value="${this._escape(val)}" ${val === current ? 'selected' : ''}>${this._escape(label)}</option>`
        ).join('');
        const body = `
            <div class="form-group">
                <label class="form-label">Wake Word</label>
                <select class="form-select" onchange="DevicesDetailModals._setWakeWordPending(this.value)">
                    ${optionsHtml}
                </select>
            </div>
            <div style="font-size: var(--font-size-sm); color: var(--text-muted);">
                Wake word is account-wide — changing it here applies to every device on your account.
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px;">
                <button class="btn btn-secondary" onclick="DevicesDetailModals.closeWakeWord()" ${this._wakeWordSaving ? 'disabled' : ''}>Cancel</button>
                <button class="btn btn-primary" onclick="DevicesDetailModals.submitWakeWord()" ${this._wakeWordSaving ? 'disabled' : ''}>${this._wakeWordSaving ? 'Saving…' : 'Save'}</button>
            </div>
        `;
        return this._modal('Wake Word', body, 'DevicesDetailModals.closeWakeWord()');
    },

    // ── Personality picker (device-level aiVoice.personalityId) ───

    _personalityOpen: false,
    _personalityDeviceId: null,
    _personalityOptions: null,  // cached after first fetch this session

    async openVoicePersonality(deviceId) {
        this._personalityOpen = true;
        this._personalityDeviceId = deviceId;
        App.renderPage();
        // Lazy-load the account's personality catalog if Voice & AI Settings
        // page hasn't been visited this session. Same path that page uses.
        if (!this._personalityOptions && typeof VoiceAiApi !== 'undefined') {
            try {
                const [templates, custom] = await Promise.all([
                    VoiceAiApi.listTemplates().catch(() => []),
                    VoiceAiApi.listCustom().catch(() => []),
                ]);
                const opts = [];
                for (const t of templates || []) {
                    const key = t.key || t.id;
                    if (key) opts.push([String(key), t.name || DevicesDetail._titleCase(key)]);
                }
                for (const c of custom || []) {
                    if (c.id) opts.push([String(c.id), c.name || 'Custom personality']);
                }
                this._personalityOptions = opts;
                App.renderPage();
            } catch { this._personalityOptions = []; }
        }
    },

    closeVoicePersonality() { this._personalityOpen = false; App.renderPage(); },

    renderVoicePersonalityModal() {
        if (!this._personalityOpen) return '';
        const device = DevicesPage._findDevice(this._personalityDeviceId);
        if (!device) return '';
        const options = this._personalityOptions || [['dashie', 'Dashie']];
        const current = device.settings?.aiVoice?.personalityId || 'dashie';
        const body = `
            <div class="form-group">
                <label class="form-label">Personality</label>
                ${DevicesDetail._settingSelectRaw(device, 'aiVoice', 'personalityId', String(current), options)}
            </div>
            <div style="font-size: var(--font-size-sm); color: var(--text-muted);">
                Manage personalities (create, edit) on the <a href="#voice-ai" onclick="event.preventDefault(); App.navigate('voice-ai')">Voice & AI</a> page.
            </div>
        `;
        return this._modal('Personality', body, 'DevicesDetailModals.closeVoicePersonality()');
    },

    // ── PIN modal (set / change / clear) ──────────────────────

    _pinOpen: false,
    _pinDeviceId: null,
    _pinHadPin: false,
    _pinForm: { value: '', confirm: '', busy: false, error: null },

    openPinModal(deviceId, hadPin) {
        this._pinOpen = true;
        this._pinDeviceId = deviceId;
        this._pinHadPin = !!hadPin;
        this._pinForm = { value: '', confirm: '', busy: false, error: null };
        App.renderPage();
    },

    closePinModal() {
        this._pinOpen = false;
        this._pinDeviceId = null;
        this._pinForm = { value: '', confirm: '', busy: false, error: null };
        App.renderPage();
    },

    _setPinField(field, value) { this._pinForm[field] = value; },

    async submitPin() {
        const f = this._pinForm;
        if (f.busy) return;
        if (!/^\d{4,8}$/.test(f.value)) {
            f.error = 'PIN must be 4–8 digits.';
            App.renderPage();
            return;
        }
        if (f.value !== f.confirm) {
            f.error = 'PINs don\'t match.';
            App.renderPage();
            return;
        }
        f.busy = true; f.error = null;
        App.renderPage();
        try {
            // No dedicated PIN write path exists yet — route through the
            // same settings broadcast pipeline; the device-side consumer
            // can read security.pin from user_devices.settings the same
            // way it reads sleep/display settings.
            DevicesPage._onSettingChange(this._pinDeviceId, 'security', 'pin', f.value);
            DevicesPage._onSettingChange(this._pinDeviceId, 'security', 'pinSet', true);
            Toast.success('PIN updated');
            this.closePinModal();
        } catch (e) {
            f.error = e?.message || String(e);
            f.busy = false;
            App.renderPage();
        }
    },

    async clearPin() {
        if (this._pinForm.busy) return;
        this._pinForm.busy = true; this._pinForm.error = null;
        App.renderPage();
        try {
            DevicesPage._onSettingChange(this._pinDeviceId, 'security', 'pin', '');
            DevicesPage._onSettingChange(this._pinDeviceId, 'security', 'pinSet', false);
            Toast.success('PIN cleared');
            this.closePinModal();
        } catch (e) {
            this._pinForm.error = e?.message || String(e);
            this._pinForm.busy = false;
            App.renderPage();
        }
    },

    renderPinModal() {
        if (!this._pinOpen) return '';
        const f = this._pinForm;
        const body = `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <div class="form-group">
                    <label class="form-label">New PIN (4–8 digits)</label>
                    <input class="form-input" type="password" inputmode="numeric" maxlength="8" value="${this._escape(f.value)}"
                        oninput="DevicesDetailModals._setPinField('value', this.value)">
                </div>
                <div class="form-group">
                    <label class="form-label">Confirm PIN</label>
                    <input class="form-input" type="password" inputmode="numeric" maxlength="8" value="${this._escape(f.confirm)}"
                        oninput="DevicesDetailModals._setPinField('confirm', this.value)">
                </div>
                ${f.error ? `<div style="color: var(--status-error, #c00); font-size: var(--font-size-sm);">${this._escape(f.error)}</div>` : ''}
                <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
                    ${this._pinHadPin ? `<button class="btn btn-secondary" onclick="DevicesDetailModals.clearPin()" ${f.busy ? 'disabled' : ''}>Clear PIN</button>` : ''}
                    <button class="btn btn-secondary" onclick="DevicesDetailModals.closePinModal()" ${f.busy ? 'disabled' : ''}>Cancel</button>
                    <button class="btn btn-primary" onclick="DevicesDetailModals.submitPin()" ${f.busy ? 'disabled' : ''}>${this._pinHadPin ? 'Update PIN' : 'Set PIN'}</button>
                </div>
            </div>
        `;
        return this._modal(this._pinHadPin ? 'Change PIN' : 'Set PIN', body, 'DevicesDetailModals.closePinModal()');
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
