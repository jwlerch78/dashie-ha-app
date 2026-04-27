/* ============================================================
   Devices Card — list-view markup + interactive controls.
   Layout:
     header: [icon] name [lock]    [status]
     stats:  battery / wifi / RAM / room / volume / brightness
     media:  [screenshot]      [camera]
             [↻ Screen ☀⚪🌙]   [📷 motion face]
     bottom: Artist — Song (only when playing)
   ============================================================ */

const ICON = path => `assets/icons/${path}`;
const iconImg = (path, size = 16, extraStyle = '') =>
    `<img src="${ICON(path)}" alt="" style="width: ${size}px; height: ${size}px; vertical-align: middle; ${extraStyle}">`;

const DevicesCard = {
    _busyControl: {},   // `${deviceId}:${role}` → bool
    _sliderOpen: null,

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
                    ${this._renderStatsRow(device, idAttr, m)}
                    ${this._renderMediaRow(device, idAttr, m)}
                    ${this._renderMusicStrip(m)}
                </div>
            </div>
        `;
    },

    _renderHeader(device, idAttr, statusBadge, conflict) {
        const icon = DevicesPage._deviceIcon(device.device_type);
        // HA's switch.<slug>_lock — state 'on' interpreted as "currently locked".
        // If your devices show inverted, flip this in ha-metrics.js.
        const locked = !!device.metrics?.controls?.lock;
        const lockBusy = !!this._busyControl[`${device.device_id}:lock`];
        const conflictChip = conflict
            ? `<span title="HA: ${DevicesPage._escape(conflict)}" style="color: var(--accent); font-size: 11px; margin-left: 6px;">⚠</span>`
            : '';
        const lockIconFile = locked ? 'icon-lock.svg' : 'icon-unlock.svg';
        return `
            <div style="display: flex; align-items: flex-start; gap: 10px;">
                <div class="device-card-icon" style="flex-shrink: 0;">${icon}</div>
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; font-weight: 600;">
                        <span>${DevicesPage._escape(device.device_name || 'Unnamed Device')}</span>
                        <button title="${locked ? 'Tap to unlock' : 'Tap to lock'}" ${lockBusy ? 'disabled' : ''}
                            onclick="event.stopPropagation(); DevicesCard.toggleSwitch('${idAttr}', 'lock', ${locked})"
                            style="background: none; border: none; cursor: ${lockBusy ? 'wait' : 'pointer'}; padding: 0; opacity: ${lockBusy ? 0.5 : 0.85}; line-height: 0;">
                            ${iconImg(lockIconFile, 16)}
                        </button>
                        ${conflictChip}
                    </div>
                    <div class="device-card-type" style="margin-top: 2px;">${DevicesPage._escape(DevicesPage._typeLabel(device))}</div>
                </div>
                <div style="flex-shrink: 0; align-self: flex-start; display: flex; align-items: center; gap: 4px;">${statusBadge}</div>
            </div>
        `;
    },

    _renderStatsRow(device, idAttr, m) {
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

        if (m.controls?.volume != null) {
            const display = this._scaleTo10(m.controls.volume, m.controls.volume_max);
            chips.push(`
                <span class="device-card-detail" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Adjust volume"
                    onclick="event.stopPropagation(); DevicesCard.openSlider('${idAttr}', 'volume', ${m.controls.volume}, ${m.controls.volume_max ?? 'null'})">
                    ${iconImg('icon-volume-high.svg', 12)}${display}
                </span>
            `);
        }
        if (m.controls?.brightness != null) {
            const display = this._scaleTo10(m.controls.brightness, m.controls.brightness_max);
            chips.push(`
                <span class="device-card-detail" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Adjust brightness"
                    onclick="event.stopPropagation(); DevicesCard.openSlider('${idAttr}', 'brightness', ${m.controls.brightness}, ${m.controls.brightness_max ?? 'null'})">
                    ${iconImg('icon-sun.svg', 12)}${display}
                </span>
            `);
        }

        if (chips.length === 0) {
            return `<div style="font-size: var(--font-size-sm); color: var(--text-muted); margin-top: 12px;">No live metrics yet</div>`;
        }
        return `<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px;">${chips.join('')}</div>`;
    },

    _renderMediaRow(device, idAttr, m) {
        const ph = 'background: var(--bg-muted, #f7f7f8); border: 1px dashed var(--border, #e5e7eb); border-radius: 4px; aspect-ratio: 16/9; display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--text-muted);';
        const dark = !!m.controls?.dark_mode;
        const screenOn = m.controls?.screen !== false;
        const cameraOn = !!m.controls?.camera_stream_enabled;
        const motion = !!m.presence?.motion;
        const face = !!m.presence?.face;
        const reloadBusy = !!this._busyControl[`${device.device_id}:reload`];
        const camBusy = !!this._busyControl[`${device.device_id}:camera_stream_enabled`];

        return `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
                <div>
                    <div style="${ph}">screenshot</div>
                    <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: nowrap; font-size: 11px;">
                        <button title="Reload dashboard" ${reloadBusy ? 'disabled' : ''}
                            onclick="event.stopPropagation(); DevicesCard.pressButton('${idAttr}', 'reload')"
                            style="background: none; border: none; cursor: ${reloadBusy ? 'wait' : 'pointer'}; padding: 2px; opacity: ${reloadBusy ? 0.5 : 0.85}; line-height: 0; flex-shrink: 0;">
                            ${iconImg('icon-reload.svg', 14)}
                        </button>
                        ${this._renderTextToggle(idAttr, 'screen', screenOn, 'Screen')}
                        ${this._renderIconToggle(idAttr, 'dark_mode', dark, 'icon-sun.svg', 'icon-moon.svg', 'Light/dark')}
                    </div>
                </div>
                <div>
                    <div style="${ph}">camera</div>
                    <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px;">
                        <button title="${cameraOn ? 'Camera streaming' : 'Camera off'}" ${camBusy ? 'disabled' : ''}
                            onclick="event.stopPropagation(); DevicesCard.toggleSwitch('${idAttr}', 'camera_stream_enabled', ${cameraOn})"
                            style="background: none; border: none; cursor: ${camBusy ? 'wait' : 'pointer'}; padding: 2px; line-height: 0;">
                            ${iconImg('icon-video-camera.svg', 16, `opacity: ${cameraOn ? 1 : 0.4};`)}
                        </button>
                        <span title="Motion ${motion ? 'detected' : 'idle'}" style="font-size: 14px; opacity: ${motion ? 1 : 0.35};">🚶</span>
                        <span title="Face ${face ? 'detected' : 'idle'}" style="line-height: 0;">
                            ${iconImg('icon-profile-round.svg', 14, `opacity: ${face ? 1 : 0.35};`)}
                        </span>
                    </div>
                </div>
            </div>
        `;
    },

    _renderTextToggle(idAttr, role, isOn, label) {
        const busy = !!this._busyControl[`${idAttr}:${role}`];
        return `
            <label title="${DevicesPage._escape(label)}" style="display: inline-flex; align-items: center; gap: 4px; cursor: ${busy ? 'wait' : 'pointer'}; opacity: ${busy ? 0.5 : 1}; font-size: 11px; flex-shrink: 0;"
                onclick="event.stopPropagation();">
                <span>${DevicesPage._escape(label)}</span>
                ${this._renderSwitchInner(idAttr, role, isOn, busy, 24, 12)}
            </label>
        `;
    },

    _renderIconToggle(idAttr, role, isOn, offIconFile, onIconFile, label) {
        const busy = !!this._busyControl[`${idAttr}:${role}`];
        return `
            <label title="${DevicesPage._escape(label)}" style="display: inline-flex; align-items: center; gap: 3px; cursor: ${busy ? 'wait' : 'pointer'}; opacity: ${busy ? 0.5 : 1}; flex-shrink: 0;"
                onclick="event.stopPropagation();">
                ${iconImg(offIconFile, 12, `opacity: ${isOn ? 0.35 : 1};`)}
                ${this._renderSwitchInner(idAttr, role, isOn, busy, 24, 12)}
                ${iconImg(onIconFile, 12, `opacity: ${isOn ? 1 : 0.35};`)}
            </label>
        `;
    },

    _renderSwitchInner(idAttr, role, isOn, busy, w = 28, h = 16) {
        const knobSize = h - 4;
        const knobLeft = isOn ? (w - knobSize - 2) : 2;
        return `
            <span style="position: relative; display: inline-block; width: ${w}px; height: ${h}px;">
                <input type="checkbox" ${isOn ? 'checked' : ''} ${busy ? 'disabled' : ''}
                    onclick="event.stopPropagation(); DevicesCard.toggleSwitch('${idAttr}', '${role}', ${isOn})"
                    style="opacity: 0; width: 0; height: 0;">
                <span style="position: absolute; cursor: ${busy ? 'wait' : 'pointer'}; top: 0; left: 0; right: 0; bottom: 0; background: ${isOn ? 'var(--accent, #3b82f6)' : '#d1d5db'}; transition: 0.2s; border-radius: ${h}px;">
                    <span style="position: absolute; left: ${knobLeft}px; top: 2px; width: ${knobSize}px; height: ${knobSize}px; background: white; border-radius: 50%; transition: 0.2s;"></span>
                </span>
            </span>
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
                ${iconImg('icon-music.svg', 12)}
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${DevicesPage._escape(text)}</span>
            </div>
        `;
    },

    _scaleTo10(value, max) {
        if (value == null) return '—';
        if (!max || max === 10) return Math.round(value);
        return Math.max(0, Math.min(10, Math.round(value / max * 10)));
    },

    // ---- Live actions ----

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

    // ---- Slider dialog (volume / brightness, normalized 1-10) ----

    openSlider(deviceId, role, currentValue, scaleMax) {
        const cfg = role === 'volume' ? { label: 'Volume' } : role === 'brightness' ? { label: 'Brightness' } : { label: role };
        const max = scaleMax || 10;
        const displayValue = !max || max === 10 ? Math.round(currentValue) : Math.round(currentValue / max * 10);
        this._sliderOpen = { deviceId, role, ...cfg, min: 0, max: 10, step: 1, value: displayValue, scaleMax: max };
        App.renderPage();
    },

    closeSlider() { this._sliderOpen = null; App.renderPage(); },

    onSliderInput(value) {
        if (!this._sliderOpen) return;
        this._sliderOpen.value = Number(value);
        const lbl = document.getElementById('devices-slider-value');
        if (lbl) lbl.textContent = `${this._sliderOpen.value}`;
    },

    async submitSlider() {
        const s = this._sliderOpen;
        if (!s) return;
        this._sliderOpen = null;
        App.renderPage();
        const key = `${s.deviceId}:${s.role}`;
        this._busyControl[key] = true;
        const actualValue = s.scaleMax === 10 ? s.value : Math.round(s.value / 10 * s.scaleMax);
        try {
            await this.control(s.deviceId, s.role, actualValue);
            const device = DevicesPage._findDevice(s.deviceId);
            if (device) {
                device.metrics = device.metrics || {};
                device.metrics.controls = device.metrics.controls || {};
                device.metrics.controls[s.role] = actualValue;
            }
            Toast.success(`${s.label} set to ${s.value}/10`);
        } catch (e) {
            console.error(`[DevicesCard] slider ${s.role} failed:`, e);
            Toast.error(Toast.friendly(e, `set ${s.role}`));
        } finally {
            delete this._busyControl[key];
            App.renderPage();
        }
    },

    renderSliderModal() {
        const s = this._sliderOpen;
        if (!s) return '';
        return `
            <div onclick="DevicesCard._maybeClose(event)" style="position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px;">
                <div onclick="event.stopPropagation()" class="card" style="max-width: 360px; width: 100%;">
                    <div class="card-body">
                        <strong style="font-size: var(--font-size-lg);">${DevicesPage._escape(s.label)}</strong>
                        <div style="margin: 16px 0; text-align: center; font-size: 28px; font-weight: 600;" id="devices-slider-value">${s.value}</div>
                        <input type="range" min="0" max="10" step="1" value="${s.value}"
                            oninput="DevicesCard.onSliderInput(this.value)" style="width: 100%;">
                        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                            <span>0</span><span>10</span>
                        </div>
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
