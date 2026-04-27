/* ============================================================
   Devices Card — list-view markup + interactive controls.
   ------------------------------------------------------------
   Header:  [icon] device-name [lock SVG] · [status top-right]
   Body L:  battery / wifi / RAM / room (Phase 2) / volume / brightness
            — volume + brightness are clickable chips that open a slider
              dialog calling /api/ha/control.
   Body R:  screenshot + camera placeholders (Phase 3 wires real image proxy).
   Footer:  toggle switches for dark/light + screen on/off, reload button,
            motion/face status icon. All wired via DevicesCard.control().
   Bottom:  "Artist — Song" strip when media_player is playing; nothing otherwise.
   ============================================================ */

const ICON = path => `assets/icons/${path}`;

const DevicesCard = {
    _busyControl: {},   // `${deviceId}:${role}` → bool — disables UI while a control call is in flight
    _sliderOpen: null,  // { deviceId, role, label, min, max, step, unit, value }

    render(device) {
        const idAttr = DevicesPage._escape(device.device_id);
        const live = DevicesPage._isLive(device);
        const conflict = DevicesPage._conflictHaName(device);
        const m = device.metrics || {};

        const statusBadge = live
            ? '<span class="status-dot online" title="Live"></span>'
            : `<span style="font-size: 11px; color: var(--text-secondary);">${DevicesPage._formatTime(device.last_seen_at)}</span> <span class="status-dot offline"></span>`;

        return `
            <div class="card card-clickable" onclick="DevicesPage.showDetail('${idAttr}')">
                <div class="card-body" style="padding: 12px;">
                    ${this._renderHeader(device, idAttr, statusBadge, conflict)}
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
                        ${this._renderLeftColumn(device, idAttr, m)}
                        ${this._renderRightColumn(device, idAttr)}
                    </div>
                    ${this._renderFooter(device, idAttr, m)}
                    ${this._renderMusicStrip(m)}
                </div>
            </div>
        `;
    },

    _renderHeader(device, idAttr, statusBadge, conflict) {
        const icon = DevicesPage._deviceIcon(device.device_type);
        const locked = !!device.metrics?.controls?.lock;
        const lockBusy = !!this._busyControl[`${device.device_id}:lock`];
        const conflictChip = conflict
            ? `<span title="HA: ${DevicesPage._escape(conflict)}" style="color: var(--accent); font-size: 11px; margin-left: 6px;">⚠</span>`
            : '';
        const lockSrc = locked ? ICON('icon-lock.svg') : ICON('icon-unlock.svg');
        return `
            <div style="display: flex; align-items: flex-start; gap: 10px;">
                <div class="device-card-icon" style="flex-shrink: 0;">${icon}</div>
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; font-weight: 600;">
                        <span>${DevicesPage._escape(device.device_name || 'Unnamed Device')}</span>
                        <button title="${locked ? 'Tap to unlock' : 'Tap to lock'}" ${lockBusy ? 'disabled' : ''}
                            onclick="event.stopPropagation(); DevicesCard.toggleSwitch('${idAttr}', 'lock', ${locked})"
                            style="background: none; border: none; cursor: ${lockBusy ? 'wait' : 'pointer'}; padding: 0; opacity: ${lockBusy ? 0.5 : 0.85}; line-height: 0;">
                            <img src="${lockSrc}" alt="${locked ? 'Locked' : 'Unlocked'}" style="width: 16px; height: 16px;">
                        </button>
                        ${conflictChip}
                    </div>
                    <div class="device-card-type" style="margin-top: 2px;">${DevicesPage._escape(DevicesPage._typeLabel(device))}</div>
                </div>
                <div style="flex-shrink: 0; align-self: flex-start; display: flex; align-items: center; gap: 4px;">${statusBadge}</div>
            </div>
        `;
    },

    _renderLeftColumn(device, idAttr, m) {
        const chips = [];
        if (m.battery?.level != null) {
            const charge = m.battery.charging ? '⚡' : '🔋';
            chips.push(`<span class="device-card-detail">${charge} ${m.battery.level}%</span>`);
        }
        if (m.network?.wifi_signal_percent != null) {
            chips.push(`<span class="device-card-detail">📶 ${m.network.wifi_signal_percent}%</span>`);
        }
        if (m.system?.ram_used_percent != null) {
            chips.push(`<span class="device-card-detail">RAM ${m.system.ram_used_percent}%</span>`);
        }
        const room = device.metrics?.ha_area || device.ha_area;
        if (room) chips.push(`<span class="device-card-detail">🏠 ${DevicesPage._escape(room)}</span>`);

        // Volume and brightness — clickable to open slider dialog.
        if (m.controls?.volume != null) {
            chips.push(`
                <span class="device-card-detail" style="cursor: pointer;" title="Adjust volume"
                    onclick="event.stopPropagation(); DevicesCard.openSlider('${idAttr}', 'volume', ${m.controls.volume})">
                    <img src="${ICON('icon-volume-high.svg')}" alt="" style="width: 12px; height: 12px; vertical-align: middle; margin-right: 2px;">${m.controls.volume}
                </span>
            `);
        }
        if (m.controls?.brightness != null) {
            chips.push(`
                <span class="device-card-detail" style="cursor: pointer;" title="Adjust brightness"
                    onclick="event.stopPropagation(); DevicesCard.openSlider('${idAttr}', 'brightness', ${m.controls.brightness})">
                    <img src="${ICON('icon-sun.svg')}" alt="" style="width: 12px; height: 12px; vertical-align: middle; margin-right: 2px;">${m.controls.brightness}
                </span>
            `);
        }
        if (chips.length === 0) {
            return `<div style="font-size: var(--font-size-sm); color: var(--text-muted);">No live metrics yet</div>`;
        }
        return `<div style="display: flex; flex-wrap: wrap; gap: 6px; align-content: flex-start;">${chips.join('')}</div>`;
    },

    _renderRightColumn(device, idAttr) {
        // Phase 3 wires real screenshot + camera. Placeholders for now.
        const ph = 'background: var(--bg-muted, #f7f7f8); border: 1px dashed var(--border, #e5e7eb); border-radius: 4px; aspect-ratio: 16/9; display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--text-muted);';
        return `
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <div style="${ph}">screenshot</div>
                <div style="${ph}">camera</div>
            </div>
        `;
    },

    _renderFooter(device, idAttr, m) {
        const dark = !!m.controls?.dark_mode;
        const screenOn = m.controls?.screen !== false;  // null/undefined treat as on (don't show false until we know)
        const motion = !!m.presence?.motion;
        const face = !!m.presence?.face;
        const presenceLabel = motion ? 'motion' : (face ? 'face' : 'idle');

        const reloadBusy = !!this._busyControl[`${device.device_id}:reload`];

        return `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border, #e5e7eb);">
                ${this._renderToggle(idAttr, 'dark_mode', dark, ICON('icon-sun.svg'), ICON('icon-moon.svg'), 'Light/dark')}
                ${this._renderToggle(idAttr, 'screen', screenOn, '⊙', '🛏', 'Screen on/off')}
                <button title="Reload dashboard" ${reloadBusy ? 'disabled' : ''}
                    onclick="event.stopPropagation(); DevicesCard.pressButton('${idAttr}', 'reload')"
                    style="background: none; border: none; cursor: ${reloadBusy ? 'wait' : 'pointer'}; padding: 4px; opacity: ${reloadBusy ? 0.5 : 0.85}; line-height: 0;">
                    <img src="${ICON('icon-reload.svg')}" alt="Reload" style="width: 16px; height: 16px;">
                </button>
                <span title="Motion / face detection" style="font-size: 11px; color: var(--text-secondary); padding: 4px;">
                    👤 ${presenceLabel}
                </span>
            </div>
        `;
    },

    /** A small CSS toggle switch. `offIcon`/`onIcon` can be SVG paths or emoji. */
    _renderToggle(idAttr, role, isOn, offIcon, onIcon, label) {
        const busy = !!this._busyControl[`${idAttr}:${role}`];
        const renderIcon = (src) => src.startsWith('assets/')
            ? `<img src="${src}" alt="" style="width: 12px; height: 12px;">`
            : `<span style="font-size: 11px;">${src}</span>`;
        return `
            <label title="${DevicesPage._escape(label)}" style="display: inline-flex; align-items: center; gap: 4px; cursor: ${busy ? 'wait' : 'pointer'}; opacity: ${busy ? 0.5 : 1};"
                onclick="event.stopPropagation();">
                ${renderIcon(offIcon)}
                <span style="position: relative; display: inline-block; width: 28px; height: 16px;">
                    <input type="checkbox" ${isOn ? 'checked' : ''} ${busy ? 'disabled' : ''}
                        onclick="event.stopPropagation(); DevicesCard.toggleSwitch('${idAttr}', '${role}', ${isOn})"
                        style="opacity: 0; width: 0; height: 0;">
                    <span style="position: absolute; cursor: ${busy ? 'wait' : 'pointer'}; top: 0; left: 0; right: 0; bottom: 0; background: ${isOn ? 'var(--accent, #3b82f6)' : '#d1d5db'}; transition: 0.2s; border-radius: 16px;">
                        <span style="position: absolute; left: ${isOn ? '14px' : '2px'}; top: 2px; width: 12px; height: 12px; background: white; border-radius: 50%; transition: 0.2s;"></span>
                    </span>
                </span>
                ${renderIcon(onIcon)}
            </label>
        `;
    },

    _renderMusicStrip(m) {
        if (m.media?.state !== 'playing') return '';
        const artist = m.media.artist || '';
        const title = m.media.title || '';
        if (!artist && !title) return '';
        const text = artist && title ? `${artist} — ${title}` : (title || artist);
        return `
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border, #e5e7eb); display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary);">
                <img src="${ICON('icon-music.svg')}" alt="" style="width: 12px; height: 12px;">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${DevicesPage._escape(text)}</span>
            </div>
        `;
    },

    // ---- Live actions ----

    /** Toggle a switch-domain control. role = 'lock'|'screen'|'dark_mode'|... */
    async toggleSwitch(deviceId, role, currentlyOn) {
        const key = `${deviceId}:${role}`;
        if (this._busyControl[key]) return;
        this._busyControl[key] = true;
        App.renderPage();
        try {
            await this.control(deviceId, role, !currentlyOn);
            const device = DevicesPage._findDevice(deviceId);
            if (device) {
                device.metrics = device.metrics || {};
                device.metrics.controls = device.metrics.controls || {};
                device.metrics.controls[role] = !currentlyOn;
            }
        } catch (e) {
            console.error(`[DevicesCard] toggle ${role} failed:`, e);
            Toast.error(Toast.friendly(e, `toggle ${role.replace('_', ' ')}`));
        } finally {
            delete this._busyControl[key];
            App.renderPage();
        }
    },

    /** Fire a button-domain control (no value). */
    async pressButton(deviceId, role) {
        const key = `${deviceId}:${role}`;
        if (this._busyControl[key]) return;
        this._busyControl[key] = true;
        App.renderPage();
        try {
            await this.control(deviceId, role, null);
            Toast.success(`${role.replace('_', ' ')} sent`);
        } catch (e) {
            console.error(`[DevicesCard] press ${role} failed:`, e);
            Toast.error(Toast.friendly(e, `press ${role}`));
        } finally {
            delete this._busyControl[key];
            App.renderPage();
        }
    },

    // ---- Slider dialog (volume / brightness) ----

    openSlider(deviceId, role, currentValue) {
        const cfg = role === 'volume'
            ? { label: 'Volume', min: 0, max: 100, step: 1, unit: '' }
            : role === 'brightness'
                ? { label: 'Brightness', min: 0, max: 100, step: 1, unit: '%' }
                : { label: role, min: 0, max: 100, step: 1, unit: '' };
        this._sliderOpen = { deviceId, role, value: currentValue ?? 50, ...cfg };
        App.renderPage();
    },

    closeSlider() { this._sliderOpen = null; App.renderPage(); },

    onSliderInput(value) {
        if (!this._sliderOpen) return;
        this._sliderOpen.value = Number(value);
        // Update the on-screen value live without re-rendering everything
        const lbl = document.getElementById('devices-slider-value');
        if (lbl) lbl.textContent = `${this._sliderOpen.value}${this._sliderOpen.unit}`;
    },

    async submitSlider() {
        const s = this._sliderOpen;
        if (!s) return;
        this._sliderOpen = null;
        App.renderPage();
        const key = `${s.deviceId}:${s.role}`;
        this._busyControl[key] = true;
        try {
            await this.control(s.deviceId, s.role, s.value);
            const device = DevicesPage._findDevice(s.deviceId);
            if (device) {
                device.metrics = device.metrics || {};
                device.metrics.controls = device.metrics.controls || {};
                device.metrics.controls[s.role] = s.value;
            }
            Toast.success(`${s.label} set to ${s.value}${s.unit}`);
        } catch (e) {
            console.error(`[DevicesCard] slider ${s.role} failed:`, e);
            Toast.error(Toast.friendly(e, `set ${s.role}`));
        } finally {
            delete this._busyControl[key];
            App.renderPage();
        }
    },

    /** Render the slider modal (called by DevicesPage._renderList / _renderDetail). */
    renderSliderModal() {
        const s = this._sliderOpen;
        if (!s) return '';
        return `
            <div onclick="DevicesCard._maybeClose(event)" style="position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px;">
                <div onclick="event.stopPropagation()" class="card" style="max-width: 360px; width: 100%;">
                    <div class="card-body">
                        <strong style="font-size: var(--font-size-lg);">${DevicesPage._escape(s.label)}</strong>
                        <div style="margin: 16px 0; text-align: center; font-size: 24px; font-weight: 600;" id="devices-slider-value">${s.value}${s.unit}</div>
                        <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"
                            oninput="DevicesCard.onSliderInput(this.value)"
                            style="width: 100%;">
                        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                            <button class="btn btn-secondary btn-sm" onclick="DevicesCard.closeSlider()">Cancel</button>
                            <button class="btn btn-primary btn-sm" onclick="DevicesCard.submitSlider()">Save</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    _maybeClose(e) { if (e.target === e.currentTarget) this.closeSlider(); },

    /** Generic control passthrough — used by toggles, buttons, sliders. */
    async control(deviceId, role, value) {
        if (!DashieAuth.isAddonMode) {
            throw new Error('Device controls require running inside Dashie Hub');
        }
        const resp = await fetch(DashieAuth._addonUrl('/api/ha/control'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, role, value }),
        });
        if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`control HTTP ${resp.status}: ${body.slice(0, 200)}`);
        }
        return resp.json();
    },
};
