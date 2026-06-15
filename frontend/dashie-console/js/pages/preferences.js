/* ============================================================
   Preferences page
   ------------------------------------------------------------
   Account-wide user preferences. Mirrors the Kotlin native
   "Preferences" page (halite/settings/schemas/PreferencesPageSchema.kt)
   so a setting changed here is visible on the tablet, and vice
   versa — both sides round-trip through user_settings.

   Sections:
     - Language          general.language        picker (15 locales)
     - Date & Time       display.use24HourClock  toggle
                         display.dateFormat       picker (mdy/dmy)
                         time.useHa               toggle
     - Weather           display.temperatureUnit  picker (F/C)
                         general.zipCode          text
                         weather.useHa            toggle

   The "Use HA for time/weather" toggles are per-device in Kotlin;
   here they act as the account default a new device picks up at
   registration. A per-device override would live on Devices later.

   Saves: every change calls DashieAuth.saveUserSettings(full) after
   a 300ms debounce per field. The whole user_settings JSON gets
   round-tripped, so we deep-merge into the freshly-loaded snapshot
   before each save to avoid clobbering other categories another
   thread may have written.
   ============================================================ */

const PreferencesPage = {
    _settings: null,         // full user_settings tree, fetched on entry
    _loading: false,
    _error: null,
    _saving: false,
    _saveTimer: null,        // debounce for text-input changes

    // Mirrors Kotlin's PreferencesPageSchema.languageOptions(). 'system'
    // means "follow the device locale" — the webapp falls through to
    // its built-in default in that case (no LANGUAGE in the AI prompt).
    LANGUAGE_OPTIONS: [
        ['system', 'System default'],
        ['en-US', 'English (US)'],
        ['en-GB', 'English (UK)'],
        ['es-ES', 'Spanish'],
        ['es-US', 'Spanish (US)'],
        ['fr-FR', 'French'],
        ['de-DE', 'German'],
        ['it-IT', 'Italian'],
        ['pt-BR', 'Portuguese (Brazil)'],
        ['nl-NL', 'Dutch'],
        ['pl-PL', 'Polish'],
        ['hi-IN', 'Hindi'],
        ['ja-JP', 'Japanese'],
        ['ko-KR', 'Korean'],
        ['zh-CN', 'Chinese (Simplified)'],
    ],

    DATE_FORMAT_OPTIONS: [
        ['mdy', 'Month Day, Year'],
        ['dmy', 'Day Month Year'],
    ],

    TEMP_OPTIONS: [
        ['F', 'Fahrenheit'],
        ['C', 'Celsius'],
    ],

    topBarTitle()    { return 'Preferences'; },
    topBarSubtitle() { return 'Account-wide settings shared across all your devices'; },

    onNavigateTo() { this._fetchSettings(); },

    async _fetchSettings() {
        this._loading = true;
        this._error = null;
        App.renderPage();
        try {
            this._settings = (await DashieAuth.loadUserSettings()) || {};
        } catch (e) {
            this._error = e?.message || String(e);
        }
        this._loading = false;
        App.renderPage();
    },

    // ── reads ─────────────────────────────────────────────────
    //
    // Reading nested keys: settings.general?.language etc. Defaults
    // mirror what the dashboard's settingsStore would return when the
    // key is absent — so a fresh account renders the same as a long-
    // standing one.

    _read(category, key, fallback) {
        return this._settings?.[category]?.[key] ?? fallback;
    },

    // ── writes ────────────────────────────────────────────────

    _setField(category, key, value) {
        if (!this._settings) return;
        if (!this._settings[category]) this._settings[category] = {};
        this._settings[category][key] = value;
        App.renderPage();          // reflect the change immediately
        this._scheduleSave();
    },

    _scheduleSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._save(), 300);
    },

    async _save() {
        this._saveTimer = null;
        if (!this._settings || this._saving) return;
        this._saving = true;
        try {
            // Refetch + deep-merge before save so we don't clobber
            // a category another tab/device wrote between our load and
            // this save. Cheap belt-and-suspenders; the typical case
            // is a single user editing in one place.
            const remote = (await DashieAuth.loadUserSettings()) || {};
            const merged = this._mergeRemoteIntoLocal(remote, this._settings);
            await DashieAuth.saveUserSettings(merged);
            this._settings = merged;
            // Bust the chat client's cached language so the next turn
            // sees the new locale without a page reload.
            window.ConsoleAiClient?.invalidateLanguageCache?.();
        } catch (e) {
            Toast?.error?.(`Save failed: ${e?.message || e}`);
        } finally {
            this._saving = false;
            App.renderPage();
        }
    },

    /** For each category the user touched on this page, keep the local
     *  value; for every other category, prefer the remote snapshot. */
    _mergeRemoteIntoLocal(remote, local) {
        const ourCategories = new Set(['general', 'display', 'time', 'weather']);
        const out = { ...remote };
        for (const cat of ourCategories) {
            if (local[cat]) out[cat] = { ...(remote[cat] || {}), ...local[cat] };
        }
        return out;
    },

    // ── render ────────────────────────────────────────────────

    render() {
        if (this._error) {
            return `
                <div style="max-width: 800px;">
                    <div class="card"><div class="card-body" style="color: var(--status-error, #c00);">
                        Couldn't load preferences: ${this._escape(this._error)}
                        <button class="btn btn-secondary btn-sm" style="margin-left: 12px;" onclick="PreferencesPage._fetchSettings()">Retry</button>
                    </div></div>
                </div>`;
        }

        if (this._loading && !this._settings) {
            return `<div style="max-width: 800px; color: var(--text-muted); padding: 20px 0;">Loading…</div>`;
        }

        return `
            <div style="max-width: 800px;">
                ${this._renderLanguageSection()}
                ${this._renderDateTimeSection()}
                ${this._renderWeatherSection()}
                ${this._saving ? `<div style="color: var(--text-muted); font-size: var(--font-size-sm); padding: 8px 4px;">Saving…</div>` : ''}
            </div>
        `;
    },

    _renderLanguageSection() {
        const current = this._read('general', 'language', 'system');
        return `
            <div class="card" style="margin-bottom: 16px;">
                <div class="card-body">
                    <div class="section-header" style="font-weight: 600; padding: 0 4px 8px;">Language</div>
                    ${this._renderPickerRow('Language', current, this.LANGUAGE_OPTIONS,
                        `PreferencesPage._setField('general', 'language', this.value)`)}
                </div>
            </div>
        `;
    },

    _renderDateTimeSection() {
        const use24 = this._read('display', 'use24HourClock', false);
        const fmt = this._read('display', 'dateFormat', 'mdy');
        const useHa = this._read('time', 'useHa', false);
        return `
            <div class="card" style="margin-bottom: 16px;">
                <div class="card-body">
                    <div class="section-header" style="font-weight: 600; padding: 0 4px 8px;">Date & Time</div>
                    ${this._renderToggleRow('24-hour Clock', use24,
                        `PreferencesPage._setField('display', 'use24HourClock', this.checked)`)}
                    ${this._renderPickerRow('Date Format', fmt, this.DATE_FORMAT_OPTIONS,
                        `PreferencesPage._setField('display', 'dateFormat', this.value)`)}
                    ${this._renderToggleRow('Use Home Assistant for time', useHa,
                        `PreferencesPage._setField('time', 'useHa', this.checked)`)}
                </div>
            </div>
        `;
    },

    _renderWeatherSection() {
        const tempUnit = this._read('display', 'temperatureUnit', 'F');
        const zip = this._read('general', 'zipCode', '');
        const useHa = this._read('weather', 'useHa', false);
        return `
            <div class="card" style="margin-bottom: 16px;">
                <div class="card-body">
                    <div class="section-header" style="font-weight: 600; padding: 0 4px 8px;">Weather</div>
                    ${this._renderPickerRow('Temperature Unit', tempUnit, this.TEMP_OPTIONS,
                        `PreferencesPage._setField('display', 'temperatureUnit', this.value)`)}
                    ${this._renderTextRow('Location', zip, '90210 or Berlin, Germany',
                        `PreferencesPage._setField('general', 'zipCode', this.value)`)}
                    ${this._renderToggleRow('Use Home Assistant for weather', useHa,
                        `PreferencesPage._setField('weather', 'useHa', this.checked)`)}
                </div>
            </div>
        `;
    },

    // ── row primitives ────────────────────────────────────────
    //
    // Rolled by hand because FormFields.select doesn't support
    // value/label pairs (only flat option strings).

    _renderPickerRow(label, currentValue, options, onChange) {
        const optsHtml = options.map(([val, lbl]) =>
            `<option value="${this._escape(val)}" ${val === currentValue ? 'selected' : ''}>${this._escape(lbl)}</option>`
        ).join('');
        return `
            <div class="setting-row">
                <span class="setting-row-label">${this._escape(label)}</span>
                <select class="form-select" style="max-width: 240px;" onchange="${onChange}">
                    ${optsHtml}
                </select>
            </div>
        `;
    },

    _renderToggleRow(label, checked, onChange) {
        return `
            <div class="setting-row">
                <span class="setting-row-label">${this._escape(label)}</span>
                <label class="toggle">
                    <input type="checkbox" ${checked ? 'checked' : ''} onchange="${onChange}">
                    <span class="toggle-slider"></span>
                </label>
            </div>
        `;
    },

    _renderTextRow(label, value, placeholder, onChange) {
        // Use 'change' (fired on blur) rather than 'input' so we don't
        // queue a save on every keystroke — debounce on _setField is
        // already 300ms but the network round-trip is wasteful when the
        // user is mid-type.
        return `
            <div class="setting-row">
                <span class="setting-row-label">${this._escape(label)}</span>
                <input class="form-input" type="text" value="${this._escape(value || '')}"
                    placeholder="${this._escape(placeholder)}"
                    style="max-width: 240px;"
                    onchange="${onChange}">
            </div>
        `;
    },

    _escape(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
};

window.PreferencesPage = PreferencesPage;
