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
    // Per-device screenshot cache-bust timestamp. Defaults to a stable value for
    // the current page-load session so periodic re-renders don't flash the
    // thumbnails. Bumped on user-initiated refresh OR after a screen toggle.
    _screenshotTs: {},
    _initialTs: Date.now(),
    _screenshotModal: null,
    _historyOpen: null,

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
        // HA's switch.<slug>_lock — state 'on' = currently locked.
        // We always render icon-lock.svg, using opacity to convey state
        // (icon-unlock.svg looks too similar at 16px to be reliably distinguishable).
        const locked = !!device.metrics?.controls?.lock;
        const lockBusy = !!this._busyControl[`${device.device_id}:lock`];
        const conflictChip = conflict
            ? `<span title="HA: ${DevicesPage._escape(conflict)}" style="color: var(--accent); font-size: 11px; margin-left: 6px;">⚠</span>`
            : '';
        // Colored circular badge for locked state, outline-only for unlocked.
        // Combined with swapping icon-lock.svg ↔ icon-unlock.svg (now visually distinct)
        // this gives a clear at-a-glance read at small sizes.
        const lockBg = locked ? '#f97316' : 'transparent';
        const lockBorder = locked ? '#f97316' : '#d1d5db';
        const lockFilter = locked ? 'filter: brightness(0) invert(1);' : '';
        const lockOpacity = lockBusy ? 0.4 : (locked ? 1 : 0.6);
        const lockIconFile = locked ? 'icon-lock.svg' : 'icon-unlock.svg';
        return `
            <div style="display: flex; align-items: flex-start; gap: 10px;">
                <div class="device-card-icon" style="flex-shrink: 0;">${icon}</div>
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; font-weight: 600;">
                        <span>${DevicesPage._escape(device.device_name || 'Unnamed Device')}</span>
                        <button title="${locked ? 'Locked — tap to unlock' : 'Unlocked — tap to lock'}" ${lockBusy ? 'disabled' : ''}
                            onclick="event.stopPropagation(); DevicesCard.toggleSwitch('${idAttr}', 'lock', ${locked})"
                            style="background: ${lockBg}; border: 1px solid ${lockBorder}; cursor: ${lockBusy ? 'wait' : 'pointer'}; padding: 3px; border-radius: 50%; line-height: 0; opacity: ${lockOpacity};">
                            ${iconImg(lockIconFile, 12, lockFilter)}
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
        const slug = DevicesPage._haSlugForDevice(device.device_id);
        const deviceLabel = device.device_name || 'Device';
        // Battery / RAM / Wi-Fi chips are clickable when we know the slug → opens
        // HA's history view in a Console modal (iframe), same origin as HA via Ingress.
        const historyLink = (entitySuffix, label) => slug
            ? `style="cursor: pointer;" title="${label} — open history" onclick="event.stopPropagation(); DevicesCard.openHistory('${slug}', '${entitySuffix}', '${DevicesPage._escape(deviceLabel + ' · ' + label)}')"`
            : '';
        if (m.battery?.level != null) {
            const charge = m.battery.charging ? '⚡' : '🔋';
            chips.push(`<span class="device-card-detail" ${historyLink('battery', 'Battery')}>${charge} ${m.battery.level}%</span>`);
        }
        if (m.system?.ram_used_percent != null) {
            chips.push(`<span class="device-card-detail" ${historyLink('ram_usage', 'RAM')}>RAM ${m.system.ram_used_percent}%</span>`);
        }
        if (m.network?.wifi_signal_percent != null) {
            chips.push(`<span class="device-card-detail" ${historyLink('wifi_signal', 'Wi-Fi')}>📶 ${m.network.wifi_signal_percent}%</span>`);
        }
        const room = device.metrics?.ha_area || device.ha_area;
        if (room) chips.push(`<span class="device-card-detail">🏠 ${DevicesPage._escape(room)}</span>`);

        if (m.controls?.volume != null) {
            const display = this._scaleTo10(m.controls.volume, m.controls.volume_max);
            const muted = m.controls.volume === 0;
            const volIcon = muted ? 'icon-volume-mute.svg' : 'icon-volume-high.svg';
            chips.push(`
                <span class="device-card-detail" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Adjust volume"
                    onclick="event.stopPropagation(); DevicesCard.openSlider('${idAttr}', 'volume', ${m.controls.volume}, ${m.controls.volume_max ?? 'null'})">
                    ${iconImg(volIcon, 12)}${muted ? 'Muted' : display}
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
        const panelOuter = 'position: relative; background: var(--bg-muted, #f7f7f8); border: 1px dashed var(--border, #e5e7eb); border-radius: 4px; aspect-ratio: 16/9; overflow: hidden;';
        const panelEmpty = panelOuter + 'display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--text-muted);';
        // Stable cache-bust per device: same value across re-renders within a
        // page-load session so auto-refresh doesn't flash the thumbnails. Bumped
        // by the manual refresh button or after a screen toggle.
        const ts = this._screenshotTs[device.device_id] || this._initialTs;
        const isLive = DevicesPage._isLive(device);
        const imageReady = DashieAuth.isAddonMode && device.metrics_updated_at && isLive;
        const screenshotSrc = imageReady
            ? DashieAuth._addonUrl(`/api/ha/image/${encodeURIComponent(device.device_id)}/screenshot?t=${ts}`)
            : null;
        const cameraSrc = imageReady && m.controls?.camera_stream_enabled
            ? DashieAuth._addonUrl(`/api/ha/image/${encodeURIComponent(device.device_id)}/camera?t=${ts}`)
            : null;
        const imgStyle = 'width: 100%; height: 100%; object-fit: cover; display: block;';
        // Screen off overlay — fade the screenshot and show "Screen off" text on top.
        const screenOff = m.controls?.screen === false;
        const overlay = screenOff
            ? `<div style="position: absolute; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; color: white; font-size: 13px; font-weight: 500; pointer-events: none;">Screen off</div>`
            : '';
        const screenshotPanel = !isLive
            ? `<div style="${panelOuter} display: flex; align-items: center; justify-content: center; color: var(--text-muted);">
                   <span style="font-size: 13px; font-weight: 500;">Offline</span>
               </div>`
            : screenshotSrc
                ? `<div style="${panelOuter} cursor: zoom-in;" onclick="event.stopPropagation(); DevicesCard.openScreenshotModal('${idAttr}')">
                       <img src="${screenshotSrc}" alt="screenshot" style="${imgStyle}" onerror="this.style.display='none'; this.parentElement.querySelector('.placeholder-fallback').style.display='flex';">
                       <span class="placeholder-fallback" style="display: none; position: absolute; inset: 0; align-items: center; justify-content: center; font-size: 11px; color: var(--text-muted);">no screenshot</span>
                       ${overlay}
                   </div>`
                : `<div style="${panelEmpty}">screenshot</div>`;
        // Camera offline = configured but currently off (camera_stream_enabled === false).
        // Show a clear "Camera offline" placeholder with a slashed camera icon.
        const cameraConfigured = m.controls?.camera_stream_enabled !== undefined;
        const cameraPanel = cameraSrc
            ? `<div style="${panelOuter}">
                   <img src="${cameraSrc}" alt="camera" style="${imgStyle}" onerror="this.style.display='none'; this.parentElement.querySelector('.placeholder-fallback').style.display='flex';">
                   <span class="placeholder-fallback" style="display: none; position: absolute; inset: 0; align-items: center; justify-content: center; font-size: 11px; color: var(--text-muted);">no camera</span>
               </div>`
            : (cameraConfigured && m.controls.camera_stream_enabled === false
                ? `<div style="${panelOuter} display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 6px; color: var(--text-muted);">
                       <span style="position: relative; display: inline-block; line-height: 0;">
                           ${iconImg('icon-video-camera.svg', 28, 'opacity: 0.45;')}
                           <span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 32px; color: #9ca3af; transform: rotate(-15deg);">/</span>
                       </span>
                       <span style="font-size: 11px;">Camera offline</span>
                   </div>`
                : `<div style="${panelEmpty}">camera</div>`);
        const dark = !!m.controls?.dark_mode;
        const screenOn = m.controls?.screen !== false;
        const cameraOn = !!m.controls?.camera_stream_enabled;
        const motion = !!m.presence?.motion;
        const face = !!m.presence?.face;
        const reloadBusy = !!this._busyControl[`${device.device_id}:reload`];
        const screenBusy = !!this._busyControl[`${device.device_id}:screen`];
        const darkBusy = !!this._busyControl[`${device.device_id}:dark_mode`];
        const camBusy = !!this._busyControl[`${device.device_id}:camera_stream_enabled`];

        // Reload in a pill so it matches the screen + light/dark visual style.
        const reloadIcon = `
            <button title="Reload dashboard" ${reloadBusy ? 'disabled' : ''}
                onclick="event.stopPropagation(); DevicesCard.pressButton('${idAttr}', 'reload')"
                style="display: inline-flex; align-items: center; justify-content: center; padding: 4px 10px; border-radius: 999px; border: 1px solid #d1d5db; background: #f3f4f6; cursor: ${reloadBusy ? 'wait' : 'pointer'}; opacity: ${reloadBusy ? 0.5 : 1}; line-height: 0;">
                ${iconImg('icon-reload.svg', 14)}
            </button>
        `;

        const screenPill = this._renderPill({
            idAttr, role: 'screen',
            currentlyOn: screenOn,
            iconFile: 'icon-tv.svg',
            busy: screenBusy,
            title: screenOn ? 'Screen on — tap to turn off' : 'Screen off — tap to turn on',
            palette: { onBg: '#10b981', offBg: '#f3f4f6', onBorder: '#10b981', offBorder: '#d1d5db', onIconInvert: true },
        });

        const lightDarkPill = this._renderPill({
            idAttr, role: 'dark_mode',
            currentlyOn: dark,
            iconFile: dark ? 'icon-moon.svg' : 'icon-sun.svg',
            busy: darkBusy,
            title: dark ? 'Dark mode — tap for light' : 'Light mode — tap for dark',
            palette: { onBg: '#1f2937', offBg: '#ffffff', onBorder: '#1f2937', offBorder: '#d1d5db', onIconInvert: true },
        });

        const cameraIcon = `
            <button title="${cameraOn ? 'Camera streaming — tap to stop' : 'Camera off — tap to start'}" ${camBusy ? 'disabled' : ''}
                onclick="event.stopPropagation(); DevicesCard.toggleSwitch('${idAttr}', 'camera_stream_enabled', ${cameraOn})"
                style="background: none; border: none; cursor: ${camBusy ? 'wait' : 'pointer'}; padding: 2px; line-height: 0; display: inline-flex; align-items: center;">
                ${iconImg('icon-video-camera.svg', 18, `opacity: ${cameraOn ? 1 : 0.35};`)}
            </button>
        `;

        const motionIcon = `
            <span title="Motion ${motion ? 'detected' : 'idle'}"
                  style="display: inline-flex; align-items: center; padding: 2px; line-height: 0;">
                ${iconImg('icon-motion-detection.svg', 20, `opacity: ${motion ? 1 : 0.35};`)}
            </span>
        `;

        const faceIcon = `
            <span title="Face ${face ? 'detected' : 'idle'}"
                  style="display: inline-flex; align-items: center; padding: 2px; line-height: 0;">
                ${iconImg('icon-face-detection.svg', 20, `opacity: ${face ? 1 : 0.35};`)}
            </span>
        `;

        // Three-column layout per media row: left / center / right justified.
        // 10% horizontal padding indents the left+right items inward so they don't sit
        // flush against the card edge. Offline devices: rows fade to 0.4 + clicks blocked.
        const offlineStyle = !isLive ? 'opacity: 0.4; pointer-events: none;' : '';
        const controlRow = (left, center, right) => `
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: center; gap: 4px; margin-top: 8px; padding: 0 10%; ${offlineStyle}">
                <div style="justify-self: start; display: inline-flex;">${left}</div>
                <div style="justify-self: center; display: inline-flex;">${center}</div>
                <div style="justify-self: end; display: inline-flex;">${right}</div>
            </div>
        `;

        // min-width: 0 forces the 1fr grid columns to actually share width equally
        // (without it, content can push the screenshot column wider than the camera column).
        // Show the camera column only when this device actually has camera hardware,
        // detected by the camera_stream_url sensor having a non-empty rtsp:// URL.
        // (Mio/Fire TV register camera entities by default but have no hardware →
        // empty stream URL.)
        const hasCameraSection = !!m.controls?.camera_stream_url;

        if (!hasCameraSection) {
            return `
                <div style="margin-top: 12px;">
                    <div style="max-width: 50%; margin: 0 auto;">
                        ${screenshotPanel}
                        ${controlRow(reloadIcon, screenPill, lightDarkPill)}
                    </div>
                </div>
            `;
        }

        return `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
                <div style="min-width: 0;">
                    ${screenshotPanel}
                    ${controlRow(reloadIcon, screenPill, lightDarkPill)}
                </div>
                <div style="min-width: 0;">
                    ${cameraPanel}
                    ${controlRow(cameraIcon, motionIcon, faceIcon)}
                </div>
            </div>
        `;
    },

    /**
     * Compact pill button. Color/text/icon swap based on `currentlyOn`.
     * `palette.onIconInvert: true` flips the icon to white (filter) when
     * the active background is dark/colored — letting us reuse black SVGs
     * on colored bg without authoring multiple files.
     */
    _renderPill({ idAttr, role, currentlyOn, iconFile, title, busy = false, palette }) {
        const p = palette;
        const bg = currentlyOn ? p.onBg : p.offBg;
        const border = currentlyOn ? p.onBorder : p.offBorder;
        const invert = currentlyOn && p.onIconInvert;
        return `
            <button title="${DevicesPage._escape(title)}" ${busy ? 'disabled' : ''}
                onclick="event.stopPropagation(); DevicesCard.toggleSwitch('${idAttr}', '${role}', ${currentlyOn})"
                style="display: inline-flex; align-items: center; justify-content: center; padding: 4px 10px; border-radius: 999px; border: 1px solid ${border}; background: ${bg}; cursor: ${busy ? 'wait' : 'pointer'}; opacity: ${busy ? 0.5 : 1}; line-height: 0;">
                ${iconImg(iconFile, 14, invert ? 'filter: brightness(0) invert(1);' : '')}
            </button>
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
            // After a screen toggle, the dashboard's content has changed — bump the
            // screenshot cache-bust so we re-fetch a fresh frame. Wait ~2s for the HA
            // integration to capture the new state.
            if (role === 'screen') {
                setTimeout(() => {
                    this._screenshotTs[deviceId] = Date.now();
                    App.renderPage();
                }, 2000);
            }
        } catch (e) {
            console.error(`[DevicesCard] toggle ${role} failed:`, e);
            Toast.error(Toast.friendly(e, `toggle ${role.replace('_', ' ')}`));
        } finally {
            delete this._busyControl[key];
            App.renderPage();
        }
    },

    // ---- Screenshot enlargement modal ----

    openScreenshotModal(deviceId) {
        if (!DashieAuth.isAddonMode) return;
        // Always use a fresh timestamp here so the modal grabs the latest frame.
        const src = DashieAuth._addonUrl(`/api/ha/image/${encodeURIComponent(deviceId)}/screenshot?t=${Date.now()}`);
        this._screenshotModal = { deviceId, src };
        App.renderPage();
    },

    closeScreenshotModal() {
        this._screenshotModal = null;
        App.renderPage();
    },

    renderScreenshotModal() {
        const m = this._screenshotModal;
        if (!m) return '';
        const device = DevicesPage._findDevice(m.deviceId);
        const name = device?.device_name || 'Screenshot';
        return `
            <div onclick="DevicesCard._maybeCloseScreenshot(event)" style="position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 24px; cursor: zoom-out;">
                <div onclick="event.stopPropagation()" style="max-width: 95vw; max-height: 92vh; display: flex; flex-direction: column; gap: 10px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; color: white;">
                        <strong>${DevicesPage._escape(name)}</strong>
                        <button onclick="DevicesCard.closeScreenshotModal()" style="background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.25); border-radius: 4px; padding: 4px 12px; cursor: pointer;">Close</button>
                    </div>
                    <img src="${m.src}" alt="${DevicesPage._escape(name)}" style="max-width: 95vw; max-height: 80vh; object-fit: contain; border-radius: 6px; background: #000;">
                </div>
            </div>
        `;
    },

    _maybeCloseScreenshot(e) { if (e.target === e.currentTarget) this.closeScreenshotModal(); },

    /** Open HA's built-in history view for a sensor entity inside a Console modal.
     *  We're served via Ingress (same origin as HA), so the iframe inherits HA's
     *  session cookies — no auth handshake needed. */
    openHistory(slug, entitySuffix, label) {
        const entityId = `sensor.${slug}_${entitySuffix}`;
        this._historyOpen = { entityId, label: label || entityId };
        App.renderPage();
    },

    closeHistory() { this._historyOpen = null; App.renderPage(); },

    renderHistoryModal() {
        const h = this._historyOpen;
        if (!h) return '';
        const url = `/history?entity_id=${encodeURIComponent(h.entityId)}`;
        return `
            <div onclick="DevicesCard._maybeCloseHistory(event)" style="position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 24px;">
                <div onclick="event.stopPropagation()" class="card" style="width: min(960px, 95vw); max-height: 90vh; display: flex; flex-direction: column;">
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border, #e5e7eb);">
                        <strong>${DevicesPage._escape(h.label)}</strong>
                        <button onclick="DevicesCard.closeHistory()" style="background: none; border: 1px solid var(--border, #d1d5db); border-radius: 4px; padding: 4px 12px; cursor: pointer;">Close</button>
                    </div>
                    <iframe src="${url}" style="flex: 1; min-height: 70vh; border: 0; border-radius: 0 0 6px 6px;"></iframe>
                </div>
            </div>
        `;
    },

    _maybeCloseHistory(e) { if (e.target === e.currentTarget) this.closeHistory(); },

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
        // Volume gets a Mute / Unmute toggle next to the label.
        const muteBtn = s.role === 'volume'
            ? (s.value === 0
                ? `<button class="btn btn-secondary btn-sm" onclick="DevicesCard.unmute()">Unmute</button>`
                : `<button class="btn btn-secondary btn-sm" onclick="DevicesCard.mute()">Mute</button>`)
            : '';
        return `
            <div onclick="DevicesCard._maybeClose(event)" style="position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px;">
                <div onclick="event.stopPropagation()" class="card" style="max-width: 360px; width: 100%;">
                    <div class="card-body">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                            <strong style="font-size: var(--font-size-lg);">${DevicesPage._escape(s.label)}</strong>
                            ${muteBtn}
                        </div>
                        <div style="margin: 16px 0; text-align: center; font-size: 28px; font-weight: 600;" id="devices-slider-value">${s.value === 0 && s.role === 'volume' ? 'Muted' : s.value}</div>
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

    /** Mute = set volume to 0 immediately (no Save needed). */
    async mute() {
        const s = this._sliderOpen;
        if (!s || s.role !== 'volume') return;
        s.value = 0;
        await this._submitSliderValue(0);
    },
    /** Unmute = set volume to a sensible default (5/10) immediately. */
    async unmute() {
        const s = this._sliderOpen;
        if (!s || s.role !== 'volume') return;
        s.value = 5;
        await this._submitSliderValue(5);
    },
    async _submitSliderValue(displayValue) {
        const s = this._sliderOpen;
        if (!s) return;
        const actualValue = s.scaleMax === 10 ? displayValue : Math.round(displayValue / 10 * s.scaleMax);
        this._sliderOpen = null;
        const key = `${s.deviceId}:${s.role}`;
        this._busyControl[key] = true;
        App.renderPage();
        try {
            await this.control(s.deviceId, s.role, actualValue);
            const device = DevicesPage._findDevice(s.deviceId);
            if (device) {
                device.metrics = device.metrics || {};
                device.metrics.controls = device.metrics.controls || {};
                device.metrics.controls[s.role] = actualValue;
            }
            Toast.success(displayValue === 0 ? `${s.label} muted` : `${s.label} set to ${displayValue}/10`);
        } catch (e) {
            Toast.error(Toast.friendly(e, `set ${s.role}`));
        } finally {
            delete this._busyControl[key];
            App.renderPage();
        }
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
