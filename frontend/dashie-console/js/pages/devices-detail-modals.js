/* ============================================================
   Devices Detail — section modals (Sleep, Display)
   ------------------------------------------------------------
   The detail page collapses the Display & Theme and Sleep
   sections into clickable summary rows that mirror the Kotlin
   control-center format ("22:00 / 07:00 (Black Overlay)" etc).
   Clicking a row opens a modal here with the actual editable
   fields. Each modal is a thin shell around DevicesDetail.
   settingSelect() so the persistence path matches everywhere
   else on the page — DevicesPage's broadcast pipeline picks
   up the writes.

   Summary helpers (buildSleepSummary, buildDisplaySummary)
   mirror controlcenter/ControlCenterStateProvider.kt — keep
   the strings byte-identical so the Console matches what the
   tablet shows in its own control center.
   ============================================================ */

const DevicesDetailModals = {

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
        const screenOff = (display && display['display.screenOffBehavior']) || 'black_overlay';
        const offLabel = screenOff === 'power_off' ? 'Power Off' : 'Black Overlay';
        return `${timeStr} (${offLabel})`;
    },

    /** "Default · Dark · Widgets" — theme family, mode, layout. */
    buildDisplaySummary(display) {
        const parts = [];
        const fam = display.themeFamily || 'default';
        parts.push(this._titleCase(fam));
        const mode = display.themeMode || 'dark';
        parts.push(this._titleCase(mode));
        const layout = display['preferences.layoutMode'] || 'widgets';
        parts.push(this._titleCase(layout));
        return parts.join(' · ');
    },

    /** Render a clickable summary row inside a card body. */
    renderSummaryRow(label, summary, onClick) {
        return `
            <div onclick="${onClick}" style="
                display: flex; align-items: center; justify-content: space-between;
                padding: 14px 16px; cursor: pointer; gap: 12px;
                transition: background-color 0.1s;
            " onmouseenter="this.style.background='var(--bg-subtle, #f3f4f6)'"
               onmouseleave="this.style.background='transparent'">
                <span style="font-size: var(--font-size-sm); font-weight: 500;">${this._escape(label)}</span>
                <span style="display: inline-flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: var(--font-size-sm); text-align: right;">
                    ${this._escape(summary)}
                    <span style="color: var(--text-muted); font-size: 14px;">›</span>
                </span>
            </div>
        `;
    },

    // ── Sleep modal ────────────────────────────────────────────

    _sleepOpen: false,
    _sleepDeviceId: null,

    openSleep(deviceId) {
        this._sleepOpen = true;
        this._sleepDeviceId = deviceId;
        App.renderPage();
    },

    closeSleep() {
        this._sleepOpen = false;
        this._sleepDeviceId = null;
        App.renderPage();
    },

    renderSleepModal() {
        if (!this._sleepOpen) return '';
        const device = DevicesPage._findDevice(this._sleepDeviceId);
        if (!device) return '';
        const sleep = device.settings?.sleep || {};
        const display = device.settings?.display || {};

        // Sleep Mode is a composite (Kotlin's sleep.sleepMode) — derive from
        // sleep.enabled + sleep.method so we don't break the existing storage
        // shape. Picker value: 'off' / 'schedule' / 'inactivity'.
        const enabled = sleep['sleep.enabled'] !== false;
        const method = sleep['sleep.method'] || 'schedule';
        const sleepMode = !enabled ? 'off' : method;
        const scheduleVisible = sleepMode === 'schedule';
        const inactivityVisible = sleepMode === 'inactivity';
        const optionsVisible = sleepMode !== 'off';
        const screenOff = display['display.screenOffBehavior'] || 'black_overlay';
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
                    <div style="margin: 4px 0 -4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">Schedule</div>
                    ${D.settingSelect(device, 'sleep', 'sleep.timerStart',
                        'Sleep Time', sleep['sleep.timerStart'] || '22:00', OptionCatalog.sleepTimes())}
                    ${D.settingSelect(device, 'sleep', 'sleep.timerEnd',
                        'Wake Time', sleep['sleep.timerEnd'] || '07:00', OptionCatalog.wakeTimes())}
                    ${D.settingSelect(device, 'sleep', 'sleep.resleepTimeout',
                        'Re-sleep Delay (min)', String(sleep['sleep.resleepTimeout'] ?? 15), OptionCatalog.resleepDelays())}
                ` : ''}

                ${inactivityVisible ? `
                    <div style="margin: 4px 0 -4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">Inactivity</div>
                    ${D.settingSelect(device, 'sleep', 'sleep.inactivityTimeout',
                        'Sleep After (sec)', String(sleep['sleep.inactivityTimeout'] ?? 120), OptionCatalog.inactivityTimeouts())}
                ` : ''}

                ${optionsVisible ? `
                    <div style="margin: 4px 0 -4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">Options</div>
                    ${D._settingSelectRaw(device, 'display', 'display.screenOffBehavior', screenOff, [
                        ['black_overlay', 'Black Overlay'], ['power_off', 'Power Off Screen']
                    ])}
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

    /** Picker changed sleep.sleepMode: also flip the existing storage keys
     *  (sleep.enabled, sleep.method) so the device reads the same composite. */
    _onSleepModeChange(value) {
        const device = DevicesPage._findDevice(this._sleepDeviceId);
        if (!device) return;
        const enabled = value !== 'off';
        const method = value === 'off' ? (device.settings?.sleep?.['sleep.method'] || 'schedule') : value;
        DevicesDetail._writeSetting(device, 'sleep', 'sleep.enabled', enabled);
        DevicesDetail._writeSetting(device, 'sleep', 'sleep.method', method);
        DevicesDetail._writeSetting(device, 'sleep', 'sleep.sleepMode', value);
    },

    // ── Display modal ─────────────────────────────────────────

    _displayOpen: false,
    _displayDeviceId: null,

    openDisplay(deviceId) {
        this._displayOpen = true;
        this._displayDeviceId = deviceId;
        App.renderPage();
    },

    closeDisplay() {
        this._displayOpen = false;
        this._displayDeviceId = null;
        App.renderPage();
    },

    renderDisplayModal() {
        if (!this._displayOpen) return '';
        const device = DevicesPage._findDevice(this._displayDeviceId);
        if (!device) return '';
        const display = device.settings?.display || {};

        const D = DevicesDetail;
        const body = `
            <div class="form-grid">
                ${D.settingSelect(device, 'display', 'themeFamily',
                    'Theme', display.themeFamily || 'default', OptionCatalog.themeFamilies())}
                ${D.settingSelect(device, 'display', 'themeMode',
                    'Mode', display.themeMode || 'dark', OptionCatalog.themeModes())}
                ${D.settingSelect(device, 'display', 'preferences.layoutMode',
                    'Layout', display['preferences.layoutMode'] || 'widgets', OptionCatalog.layoutModes())}
                ${D.settingSelect(device, 'display', 'preferences.animationLevel',
                    'Animation Level', display['preferences.animationLevel'] || 'high', OptionCatalog.animationLevels())}
            </div>
            <div style="margin-top: 12px; font-size: var(--font-size-sm); color: var(--text-muted);">
                More display options (font sizes, zoom, weather overlay, etc.) can be set from the dashboard's Settings page on the device.
            </div>
        `;
        return this._modal('Display & Theme', body, 'DevicesDetailModals.closeDisplay()');
    },

    // ── Shared modal shell ────────────────────────────────────

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

    // ── Helpers ────────────────────────────────────────────────

    /** Mirror Kotlin formatTimeout — "30 sec" / "2 min" / "1 hour". */
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

    /** "22:00" → "10:00pm" (lowercased am/pm to match the Kotlin look). */
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

    _titleCase(s) {
        if (!s) return '';
        return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
    },

    _escape(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
};

window.DevicesDetailModals = DevicesDetailModals;
