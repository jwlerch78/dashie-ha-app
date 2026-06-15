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
    /** Per-section expand/collapse state (keyed by section id). Persisted
     *  to localStorage so a user's preferred view sticks across reloads. */
    _SECTION_STATE_KEY: 'dashie_devices_detail_sections',
    _sectionExpanded: null,
    _loadSections() {
        if (this._sectionExpanded) return;
        try {
            this._sectionExpanded = JSON.parse(localStorage.getItem(this._SECTION_STATE_KEY) || '{}');
        } catch { this._sectionExpanded = {}; }
    },
    _isExpanded(sectionId, defaultExpanded = true) {
        this._loadSections();
        const v = this._sectionExpanded[sectionId];
        return v === undefined ? defaultExpanded : !!v;
    },
    toggleSection(sectionId) {
        this._loadSections();
        const next = !this._isExpanded(sectionId);
        this._sectionExpanded[sectionId] = next;
        try { localStorage.setItem(this._SECTION_STATE_KEY, JSON.stringify(this._sectionExpanded)); } catch {}
        App.renderPage();
    },

    /** Render a collapsible card section with a caret header. */
    _section(sectionId, title, bodyHtml, opts = {}) {
        const expanded = this._isExpanded(sectionId, opts.defaultExpanded !== false);
        const caret = expanded ? '▾' : '▸';
        const titleColor = opts.titleColor || '';
        return `
            <div class="section-header" style="cursor: pointer; ${titleColor}" onclick="DevicesDetail.toggleSection('${sectionId}')">
                <span style="display: inline-block; width: 14px;">${caret}</span> ${DevicesPage._escape(title)}
            </div>
            ${expanded ? bodyHtml : ''}
        `;
    },

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
            <div style="display: flex; align-items: flex-start; gap: 16px; margin-bottom: 24px; flex-wrap: wrap;">
                <div style="display: flex; align-items: flex-start; gap: 12px; flex: 1 1 320px; min-width: 0;">
                    <div class="device-card-icon" style="width: 48px; height: 48px; font-size: 24px; flex-shrink: 0;">${icon}</div>
                    <div style="flex: 1; min-width: 0;">
                        ${DevicesRename.renderNameRow(device, conflict, 'detail',
                            this._renderLockToggle(device, m, live) + this._renderRefreshButton(device, live))}
                        <div style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-top: 4px;">
                            ${DevicesPage._escape(DevicesPage._typeLabel(device))} ·
                            <span class="status-dot ${live ? 'online' : 'offline'}"></span>${live ? 'Live' : 'Offline'}
                        </div>
                        ${this._renderIdLine(device)}
                        ${this._renderVersionIpLine(device, m)}
                        ${conflictBadge}
                        ${this._renderHeaderChips(device, m)}
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;">
                    ${this._renderHeaderActions(device, m, live)}
                    ${this._renderHeaderPreview(device, m, live)}
                </div>
            </div>
            ${this._renderQuickControls(device, m, live)}
            ${this._renderDisplaySection(device, display, sleep)}
            ${this._renderVoiceSection(device, aiVoice, voice)}
            ${this._renderHomeAssistantSection(device)}
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
            ${DevicesDetailModals.renderSleepModal()}
            ${DevicesDetailModals.renderThemeModal()}
            ${DevicesDetailModals.renderPickerModal()}
            ${DevicesDetailModals.renderScreensaverModal()}
            ${DevicesDetailModals.renderVoicePersonalityModal()}
            ${DevicesDetailModals.renderWakeWordModal()}
            ${DevicesDetailModals.renderPinModal()}
        `;
    },

    // =========================================================
    //  Quick Controls — primary device actions (lock / screen /
    //  dark mode / camera / reload / brightness / volume)
    // =========================================================

    _renderQuickControls(device, m, live) {
        if (!live) {
            return this._section('quick-controls', 'Quick Controls', `
                <div class="card"><div class="card-body" style="color: var(--text-muted); font-size: var(--font-size-sm);">
                    Device is offline. Quick controls become available when the device checks in.
                </div></div>
            `);
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

        // Lock moved to the header (next to the name + refresh icon),
        // not duplicated here.

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

        // Camera stream toggle — only when the device has actual camera
        // hardware. The Dashie app reports camera_stream_enabled as a switch
        // regardless of hardware (it's a software toggle), but camera_resolution
        // only resolves to a real WxH on devices with a camera. Mirrors the
        // gate _renderMediaRow uses for the camera column on the device card.
        if (DevicesCard._isRealCameraResolution(controls.camera_resolution)) {
            const on = !!(controls.camera_streaming || controls.camera_stream_enabled);
            const busy = !!DevicesCard._busyControl[`${device.device_id}:camera_stream_enabled`];
            buttons.push(this._toggleBtn(idAttr, 'camera_stream_enabled', on, busy,
                'icon-video-camera.svg',
                on ? 'Camera on' : 'Camera off',
                on ? 'Camera streaming — tap to stop' : 'Camera off — tap to start'));
        }

        // Volume + brightness moved to the header chip row — same controls,
        // less duplication.

        // Brightness slider — kept here for tap-to-adjust convenience.
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

        // Screensaver toggle — controls.screensaver_enabled is the dashboard's
        // canonical signal for "show screensaver during sleep." Falls back to
        // device.settings.display.screensaverTimeout != 0 if the control state
        // isn't broadcast.
        const settings = device.settings || {};
        const displayCat = settings.display || {};
        const screensaverOn = controls.screensaver !== undefined
            ? !!controls.screensaver
            : (Number(displayCat.screensaverTimeout ?? 0) > 0);
        const screensaverBusy = !!DevicesCard._busyControl[`${device.device_id}:screensaver`];
        buttons.push(this._toggleBtn(idAttr, 'screensaver', screensaverOn, screensaverBusy,
            'icon-moon.svg',
            screensaverOn ? 'Screensaver on' : 'Screensaver off',
            screensaverOn ? 'Screensaver on — tap to disable' : 'Screensaver off — tap to enable'));

        // Change PIN / Set PIN — green when a PIN is set on the device,
        // gray "Set PIN" when not. Click opens the PIN modal.
        const pinSet = !!(controls.pin_set || settings.security?.pinSet);
        buttons.push(`
            <button title="${pinSet ? 'PIN is set — tap to change' : 'No PIN set — tap to create one'}"
                onclick="DevicesDetailModals.openPinModal('${idAttr}', ${pinSet})"
                style="${this._controlBtnStyle(false, pinSet)}">
                <img src="assets/icons/icon-lock.svg" alt="" style="width: 14px; height: 14px; ${pinSet ? 'filter: brightness(0) invert(1);' : ''}">
                <span>${pinSet ? 'Change PIN' : 'Set PIN'}</span>
            </button>
        `);

        if (buttons.length === 0) return '';
        return this._section('quick-controls', 'Quick Controls', `
            <div class="card"><div class="card-body">
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${buttons.join('')}
                </div>
            </div></div>
        `);
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
    //  Header — compact metric chips (battery / RAM / wifi / room
    //  / volume / brightness) styled like the card stats row, plus
    //  the small screenshot+camera preview panel that slots to the
    //  right of the title block. Both reuse DashieAuth.isAddonMode
    //  signals for image URL gating.
    // =========================================================

    _renderHeaderChips(device, m) {
        if (!m) return '';
        const chips = [];
        const idAttr = DevicesPage._escape(device.device_id);
        if (m.battery?.level != null) {
            const charge = m.battery.charging ? '⚡' : '🔋';
            chips.push(`<span class="device-card-detail">${charge} ${m.battery.level}%</span>`);
        }
        if (m.system?.ram_used_percent != null) {
            chips.push(`<span class="device-card-detail">RAM ${m.system.ram_used_percent}%</span>`);
        }
        if (m.network?.wifi_signal_percent != null) {
            chips.push(`<span class="device-card-detail">📶 ${m.network.wifi_signal_percent}%</span>`);
        }
        const room = m.ha_area || device.ha_area;
        if (room) chips.push(`<span class="device-card-detail">🏠 ${DevicesPage._escape(room)}</span>`);
        if (m.controls?.volume != null) {
            const muted = m.controls.volume === 0;
            const scaled = DevicesCard._scaleTo10
                ? DevicesCard._scaleTo10(m.controls.volume, m.controls.volume_max)
                : m.controls.volume;
            chips.push(`<span class="device-card-detail" style="cursor: pointer;" title="Adjust volume"
                onclick="DevicesCard.openSlider('${idAttr}', 'volume', ${m.controls.volume}, ${m.controls.volume_max ?? 'null'})">
                <img src="assets/icons/${muted ? 'icon-volume-mute.svg' : 'icon-volume-high.svg'}" alt="" style="width: 11px; height: 11px; vertical-align: -1px;">
                ${muted ? 'Muted' : scaled}
            </span>`);
        }
        if (m.controls?.brightness != null) {
            const scaled = DevicesCard._scaleTo10
                ? DevicesCard._scaleTo10(m.controls.brightness, m.controls.brightness_max)
                : m.controls.brightness;
            chips.push(`<span class="device-card-detail" style="cursor: pointer;" title="Adjust brightness"
                onclick="DevicesCard.openSlider('${idAttr}', 'brightness', ${m.controls.brightness}, ${m.controls.brightness_max ?? 'null'})">
                <img src="assets/icons/icon-sun.svg" alt="" style="width: 11px; height: 11px; vertical-align: -1px;">
                ${scaled}
            </span>`);
        }
        // Motion + face detection — surface only when the sensor is active
        // on the device (matches the card behavior: don't show a slashed
        // icon for sensors that aren't running at all).
        if (m.controls?.motion_detection_active) {
            const detected = !!m.controls.motion_detected;
            chips.push(`<span class="device-card-detail" title="Motion detection ${detected ? '— currently detecting motion' : 'on'}">
                <img src="assets/icons/icon-motion-detection.svg" alt="" style="width: 11px; height: 11px; vertical-align: -1px; opacity: ${detected ? 1 : 0.6};">
                ${detected ? 'Motion' : 'Motion ✓'}
            </span>`);
        }
        if (m.controls?.face_detection_active) {
            const detected = !!m.controls.face_detected;
            chips.push(`<span class="device-card-detail" title="Face detection ${detected ? '— face seen' : 'on'}">
                <img src="assets/icons/icon-face-detection.svg" alt="" style="width: 11px; height: 11px; vertical-align: -1px; opacity: ${detected ? 1 : 0.6};">
                ${detected ? 'Face' : 'Face ✓'}
            </span>`);
        }
        if (chips.length === 0) return '';
        return `<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;">${chips.join('')}</div>`;
    },

    /** Padlock icon next to the name edit. Click toggles device lock if the
     *  device exposes a lock control; otherwise renders nothing. Mirrors
     *  the card's lock chip behavior: orange when locked. */
    _renderLockToggle(device, m, live) {
        if (!live || m?.controls?.lock === undefined) return '';
        const locked = !!m.controls.lock;
        const busy = !!DevicesCard._busyControl?.[`${device.device_id}:lock`];
        const idAttr = DevicesPage._escape(device.device_id);
        const bg = locked ? '#f59e0b' : 'transparent';
        const color = locked ? '#fff' : 'var(--text-secondary)';
        return `
            <button title="${locked ? 'Locked — tap to unlock' : 'Unlocked — tap to lock'}"
                onclick="DevicesCard.pressButton('${idAttr}', 'lock')"
                ${busy ? 'disabled' : ''}
                style="background: ${bg}; border: 1px solid ${locked ? '#f59e0b' : 'var(--border, #e5e7eb)'}; border-radius: 999px; padding: 6px; cursor: ${busy ? 'wait' : 'pointer'}; opacity: ${busy ? 0.5 : 1}; line-height: 0;">
                <img src="assets/icons/${locked ? 'icon-lock.svg' : 'icon-unlock.svg'}" alt="" style="width: 14px; height: 14px; filter: ${locked ? 'invert(1)' : 'none'};">
            </button>
        `;
    },

    /** "ID: ABCDEF1234 📋" — same 10-char uppercase format as the Kotlin
     *  control center footer (StableDeviceId.take(10).uppercase()). */
    _renderIdLine(device) {
        const raw = device.device_id || '';
        const short = raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 10).toUpperCase() || raw.slice(0, 10).toUpperCase() || '—';
        return `
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; user-select: all;"
                 title="Device ID — click to copy. Useful for diagnosing HA worker matching when a device shows Offline despite being reachable.">
                <span style="text-transform: none; font-family: var(--font-sans, system-ui);">ID:</span> ${DevicesPage._escape(short)}
                <button onclick="event.stopPropagation(); navigator.clipboard.writeText('${DevicesPage._escape(raw)}').then(() => Toast.success('Device ID copied'))"
                    style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0 4px; font-size: 11px; line-height: 1;"
                    title="Copy device_id">📋</button>
            </div>
        `;
    },

    /** App version · IP address — control-center footer style. */
    _renderVersionIpLine(device, m) {
        const parts = [];
        const v = m?.app?.app_version;
        if (v) parts.push(`v${v}`);
        const ip = m?.network?.ip_address;
        if (ip) parts.push(ip);
        if (parts.length === 0) return '';
        return `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${parts.map(p => DevicesPage._escape(p)).join(' · ')}</div>`;
    },

    /** Small refresh button slotted in the name row, next to lock. */
    _renderRefreshButton(device, live) {
        if (!live) return '';
        const idAttr = DevicesPage._escape(device.device_id);
        const busy = !!DevicesCard._busyControl?.[`${device.device_id}:refresh`];
        return `
            <button title="Refresh images + device data" ${busy ? 'disabled' : ''}
                onclick="DevicesDetail.refresh('${idAttr}')"
                style="background: transparent; border: 1px solid var(--border, #e5e7eb); border-radius: 999px; padding: 6px; cursor: ${busy ? 'wait' : 'pointer'}; opacity: ${busy ? 0.5 : 1}; line-height: 0;">
                <img src="assets/icons/icon-reload.svg" alt="" style="width: 14px; height: 14px;">
            </button>
        `;
    },

    /** Send diagnostics / Send crash buttons above the preview.
     *  Backend control roles (send_diagnostics / send_crash_report) and HA
     *  button entities aren't wired yet — clicks toast a "coming soon" so
     *  the UI doesn't 400 while we plumb the entities + server route. */
    _renderHeaderActions(device, m, live) {
        const idAttr = DevicesPage._escape(device.device_id);
        const hasCrash = !!m?.app?.has_crash_report;
        const btn = (label, title, onClick, disabled) => `
            <button title="${title}" ${disabled ? 'disabled' : ''} onclick="${onClick}"
                style="padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border, #e5e7eb); background: var(--bg-card, #fff); color: var(--text-primary); cursor: ${disabled ? 'not-allowed' : 'pointer'}; opacity: ${disabled ? 0.5 : 1}; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">
                ${label}
            </button>
        `;
        const buttons = [];
        buttons.push(btn('Send diagnostics',
            'Trigger the device to upload a fresh diagnostic bundle',
            `DevicesDetail.sendDiagnostics('${idAttr}')`,
            !live));
        if (hasCrash) {
            buttons.push(btn('Send crash report',
                'Upload the pending crash report from the device',
                `DevicesDetail.sendCrashReport('${idAttr}')`,
                false));
        }
        return `<div style="display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap;">${buttons.join('')}</div>`;
    },

    /** Bump the screenshot cache-bust ts and refetch device data. */
    refresh(deviceId) {
        if (DevicesCard._screenshotTs) DevicesCard._screenshotTs[deviceId] = Date.now();
        DevicesCard._busyControl[`${deviceId}:refresh`] = true;
        App.renderPage();
        const done = () => {
            delete DevicesCard._busyControl[`${deviceId}:refresh`];
            App.renderPage();
        };
        if (typeof DevicesPage._refetchDevices === 'function') {
            DevicesPage._refetchDevices().finally(done);
        } else {
            (DevicesPage.refresh?.() || Promise.resolve()).then?.(done) || done();
        }
    },

    sendDiagnostics(_deviceId) {
        Toast.info('Send diagnostics: HA button entity not yet exposed — coming soon.');
    },

    sendCrashReport(_deviceId) {
        Toast.info('Send crash report: HA button entity not yet exposed — coming soon.');
    },

    /** Small screenshot + camera preview block for the header. Tap to open
     *  the full-screen modal that DevicesCard already renders. The image
     *  URLs match the per-card endpoints — same cache-bust ts so a manual
     *  refresh on the card list propagates here too. */
    _renderHeaderPreview(device, m, live) {
        if (!DashieAuth?.isAddonMode) return '';
        const idAttr = DevicesPage._escape(device.device_id);
        const ts = DevicesCard._screenshotTs?.[device.device_id] || DevicesCard._initialTs || Date.now();
        const imageReady = live;
        const screenshotSrc = imageReady
            ? DashieAuth._addonUrl(`/api/ha/image/${encodeURIComponent(device.device_id)}/screenshot?t=${ts}`)
            : null;
        const cameraLive = m?.controls?.camera_streaming || m?.controls?.camera_stream_enabled;
        const cameraSrc = imageReady && cameraLive
            ? DashieAuth._addonUrl(`/api/ha/image/${encodeURIComponent(device.device_id)}/camera?t=${ts}`)
            : null;
        const screenOff = m?.controls?.screen === false && !imageReady;
        const panelStyle = 'position: relative; width: 144px; height: 88px; background: var(--bg-subtle, #f3f4f6); border-radius: 8px; overflow: hidden;';
        const imgStyle = 'width: 100%; height: 100%; object-fit: cover; display: block;';
        const overlay = screenOff
            ? `<div style="position: absolute; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; font-weight: 500; pointer-events: none;">Screen off</div>`
            : '';
        const screenshotPanel = !live
            ? `<div style="${panelStyle} display: flex; align-items: center; justify-content: center; color: var(--text-muted);"><span style="font-size: 11px;">Offline</span></div>`
            : screenshotSrc
                ? `<div style="${panelStyle} cursor: zoom-in;" onclick="DevicesCard.openScreenshotModal('${idAttr}')">
                       <img src="${screenshotSrc}" alt="screenshot" style="${imgStyle}" onerror="this.style.display='none'">
                       ${overlay}
                   </div>`
                : `<div style="${panelStyle} display: flex; align-items: center; justify-content: center; color: var(--text-muted);"><span style="font-size: 11px;">No screenshot</span></div>`;
        const cameraConfigured = m?.controls?.camera_stream_enabled !== undefined;
        const cameraPanel = cameraSrc
            ? `<div style="${panelStyle} cursor: zoom-in;" onclick="DevicesCamera.open('${idAttr}')">
                   <img src="${cameraSrc}" alt="camera" style="${imgStyle}" onerror="this.style.display='none'">
               </div>`
            : cameraConfigured
                ? `<div style="${panelStyle} display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 4px; color: var(--text-muted);">
                       <img src="assets/icons/icon-video-camera.svg" alt="" style="width: 20px; height: 20px; opacity: 0.5;">
                       <span style="font-size: 10px;">Camera off</span>
                   </div>`
                : '';
        return `
            <div style="display: flex; gap: 8px; flex-shrink: 0;">
                ${screenshotPanel}
                ${cameraPanel}
            </div>
        `;
    },

    // =========================================================
    //  Live Metrics — the long-form details that don't fit in
    //  the header chips: IP / SSID / storage / app version /
    //  current page. Anything compact-able (battery / RAM% /
    //  wifi% / room / volume / brightness) lives in the header
    //  chip row instead.
    // =========================================================

    _renderMetricsPanel(device) {
        const m = device.metrics;
        if (!m) return '';
        const join = arr => arr.filter(Boolean).join(' · ');
        const rows = [
            m.network?.ip_address && ['IP address', m.network.ip_address],
            m.network?.wifi_ssid && m.network.wifi_ssid !== '<unknown ssid>' && ['Wi-Fi SSID', `"${m.network.wifi_ssid}"`],
            m.system?.ram_total_mb && ['RAM total', `${m.system.ram_total_mb} MB`
                + (m.system.ram_available_mb != null ? ` · ${m.system.ram_available_mb} MB free` : '')],
            m.storage?.free_gb != null && ['Storage',
                `${m.storage.free_gb} GB free` + (m.storage.total_gb ? ` of ${m.storage.total_gb} GB` : '')],
            m.app?.app_version && ['App', join([
                `v${m.app.app_version}`,
                m.app.android_version && `Android ${m.app.android_version}`,
                m.app.device_model,
            ])],
            m.app?.current_page && ['Current page', m.app.current_page],
            m.battery?.charging && m.battery.plug_source && ['Charging via', m.battery.plug_source],
        ].filter(r => r && r[1]);
        if (rows.length === 0) return '';
        return this._section('live-metrics', 'Live Metrics', `
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
        `, { defaultExpanded: false });
    },

    // =========================================================
    //  Display & Theme
    // =========================================================

    /** Consolidated Display section, structured to mirror Kotlin's
     *  DisplayPageSchema: three sub-section cards (Dashboard / Screen
     *  Management / Display Preferences). Each row is a summary +
     *  chevron → opens a modal owned by DevicesDetailModals. Inline
     *  toggles (Animations, Auto Brightness) skip the modal layer. */
    _renderDisplaySection(device, display, sleep) {
        const body = DevicesDetailModals.renderDisplayBody(device, display, sleep);
        return this._section('display', 'Display', body);
    },

    // =========================================================
    //  Voice & AI
    // =========================================================

    /** Voice section parity with the standalone Voice & AI Settings page:
     *  Enable Voice, Wake Word, Personality. Wake Word is account-level
     *  (in device-keys-blocklist as ai.wakeWord) so we surface it as a
     *  read-only summary with a link to Preferences — editing it here
     *  would create a per-device override that nothing reads.
     *
     *  Device-vs-account split (confirmed via blocklist + writer mapping):
     *    Device: voice.enabled, aiVoice.personalityId, aiVoice.voiceKey,
     *            aiVoice.model, voice.controlMethod/STT/TTS/...
     *    Account: ai.wakeWord (and the rest of the Preferences page) */
    _renderVoiceSection(device, aiVoice, voice) {
        const idAttr = DevicesPage._escape(device.device_id);
        const voiceEnabled = voice['voice.enabled'] !== false;
        const personality = aiVoice.personalityId || aiVoice['aiVoice.personality'] || 'dashie';
        const personalityLabel = this._titleCase(personality);

        // Wake word lives in user_settings.ai.wakeWord (account-wide).
        // Trigger an async load so the row populates from '—' to the real
        // value without the user having to click into the modal first.
        DevicesDetailModals.ensureAccountSettings();
        const wakeWordValue = DevicesDetailModals.getAccountWakeWord();
        const wakeWordLabel = wakeWordValue
            ? (DevicesDetailModals.WAKE_WORDS.find(([v]) => v === wakeWordValue)?.[1] || wakeWordValue)
            : '—';

        const rows = [
            DevicesDetailModals._toggleRow(device, 'voice', 'voice.enabled', 'Enable Voice', voiceEnabled),
            DevicesDetailModals._summaryRow('Wake Word', wakeWordLabel,
                `DevicesDetailModals.openWakeWord()`),
            DevicesDetailModals._summaryRow('Personality', personalityLabel,
                `DevicesDetailModals.openVoicePersonality('${idAttr}')`),
        ].join('');

        return this._section('voice-ai', 'Voice & AI', `
            <div class="card"><div class="card-body" style="padding: 0;">${rows}</div></div>
            <div style="margin-top: 8px; font-size: var(--font-size-sm); color: var(--text-muted);">
                Wake Word is account-wide — applies to all devices on your account.
                AI model, voice, and pipeline live on the <a href="#voice-ai" onclick="event.preventDefault(); App.navigate('voice-ai')">Voice & AI</a> page.
            </div>
        `);
    },

    // =========================================================
    //  Photos / Slideshow
    // =========================================================

    /**
     * Photos section removed — slideshow setting keys + option lists need
     * verification before exposing dropdowns here. Manage slideshow + albums
     * on the Photos page until OptionCatalog adds entries for slideshow
     * interval/transition (see add-on plan Phase F).
     */
    _renderPhotosSection() { return ''; },

    // =========================================================
    //  Home Assistant
    // =========================================================

    /** HA Dashboard URL row. The text input writes to home_assistant.dashboardPath
     *  on user_devices.settings; Kotlin's ConnectionPreferences reads it on
     *  apply. Keep this minimal — the full HA configuration flow lives in
     *  the dashboard's Settings page on the tablet. */
    _renderHomeAssistantSection(device) {
        const ha = device.settings?.home_assistant || {};
        const url = ha.dashboardPath || ha.dashboardUrl || ha.haUrl || '';
        const idAttr = DevicesPage._escape(device.device_id);
        const savingKey = `${device.device_id}_dashboardPath`;
        const isSaving = DevicesPage._saving[savingKey];
        return this._section('home-assistant', 'Home Assistant', `
            <div class="card"><div class="card-body">
                <div class="form-group">
                    <label class="form-label">Dashboard URL ${isSaving ? '<span style="color: var(--text-muted); font-weight: 400; text-transform: none; font-size: 10px;">saving…</span>' : ''}</label>
                    <input class="form-input" type="text" value="${DevicesPage._escape(url)}"
                        placeholder="https://homeassistant.local:8123/lovelace"
                        ${isSaving ? 'disabled' : ''}
                        onchange="DevicesPage._onSettingChange('${idAttr}', 'home_assistant', 'dashboardPath', this.value.trim())">
                </div>
                <div style="font-size: var(--font-size-sm); color: var(--text-muted);">
                    The dashboard the tablet opens when launching Home Assistant. Leave blank to use the default.
                </div>
            </div></div>
        `, { defaultExpanded: false });
    },

    _titleCase(s) {
        if (!s) return '—';
        return String(s).split(/[_-]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    },

    // =========================================================
    //  Device Behavior — HA switches not surfaced elsewhere
    // =========================================================

    _renderBehaviorSection(device, m) {
        const controls = m.controls || {};
        const hasCamera = DevicesCard._isRealCameraResolution(controls.camera_resolution);
        const switches = [
            { role: 'screensaver',            label: 'Screensaver',              description: 'Show photo slideshow during sleep' },
            { role: 'keep_screen_on',         label: 'Keep Screen On',           description: 'Prevent sleep while in use' },
            { role: 'auto_brightness',        label: 'Auto Brightness',          description: 'Adjust brightness based on ambient light' },
            { role: 'hide_sidebar',           label: 'Hide Sidebar',             description: 'Maximize widget area' },
            { role: 'hide_tabs',              label: 'Hide Tabs',                description: 'Remove dashboard tabs' },
            { role: 'start_on_boot',          label: 'Start on Boot',            description: 'Launch Dashie when the device powers on' },
            { role: 'camera_software_encoding', label: 'Camera Software Encoding', description: 'Use software codec (older devices)', requiresCamera: true },
        ].filter(s => {
            if (controls[s.role] === undefined) return false;
            // Camera-related switches only show when real camera hardware is present.
            // The Dashie app publishes the camera_software_encoding switch regardless
            // (it's a software preference), but the toggle is meaningless without
            // a camera. camera_resolution is the truth signal for actual hardware.
            if (s.requiresCamera && !hasCamera) return false;
            return true;
        });

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
        return this._section('behavior', 'Device Behavior', `
            <div class="card"><div class="card-body" style="padding: 4px 16px;">
                ${rows}
            </div></div>
        `);
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
        return this._section('admin', 'Admin Actions', `
            <div class="card"><div class="card-body" style="padding: 4px 16px;">
                ${rows}
            </div></div>
        `, { defaultExpanded: false });
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
        return this._section('danger', 'Danger Zone', `
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
        `, { defaultExpanded: false, titleColor: 'color: var(--status-error, #c00);' });
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

    // =========================================================
    //  Modal helpers — bare picker + toggle that DevicesDetailModals
    //  uses for its sleep / display modals. Same persistence path
    //  as settingSelect (DevicesPage._onSettingChange) so writes
    //  flow through the existing broadcast pipeline.
    // =========================================================

    /** Bare <select> WITHOUT the form-group wrapper. Used inside the
     *  sleep modal where the parent already laid out the .form-group. */
    _settingSelectRaw(device, category, key, currentValue, options, customOnChange) {
        const onChange = customOnChange
            || `DevicesPage._onSettingChange('${device.device_id}', '${category}', '${key}', this.value)`;
        const optionsHtml = options.map(([val, text]) =>
            `<option value="${val}" ${val === currentValue ? 'selected' : ''}>${text}</option>`
        ).join('');
        return `<select class="form-select" onchange="${onChange}">${optionsHtml}</select>`;
    },

    /** Boolean toggle row — same broadcast path. */
    _settingToggleRow(device, category, key, label, checked) {
        return `
            <div class="setting-row">
                <span class="setting-row-label">${DevicesPage._escape(label)}</span>
                <label class="toggle">
                    <input type="checkbox" ${checked ? 'checked' : ''}
                        onchange="DevicesPage._onSettingChange('${device.device_id}', '${category}', '${key}', this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </div>
        `;
    },

    /** Direct setting writer — used by composite keys (sleep.sleepMode
     *  expands into sleep.enabled + sleep.method writes). */
    _writeSetting(device, category, key, value) {
        DevicesPage._onSettingChange(device.device_id, category, key, value);
    },
};
