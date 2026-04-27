/* ============================================================
   Devices Card — list-view card markup + small interactive bits.
   ------------------------------------------------------------
   Header:  [icon] device-name [lock-toggle] [status top-right]
   Body:    [chips/room left]   [screenshot top / camera bottom right]
   Footer:  small placeholders/controls (song, motion/face, dark, screen,
            reload, volume, brightness) — wired in subsequent phases.

   Cross-system control surface:
     - DevicesCard.control(deviceId, role, value) → POST /api/ha/control
       (addon-mode only). Used by lock toggle now and Phase 4 controls
       (screen, dark_mode, volume, brightness, reload, …).

   State / mutation lives on DevicesPage; this file is mostly render.
   ============================================================ */

const DevicesCard = {
    /** True if a lock action is in flight for this device — disables the toggle. */
    _busyLock: {},

    render(device) {
        const idAttr = DevicesPage._escape(device.device_id);
        const icon = DevicesPage._deviceIcon(device.device_type);
        const live = DevicesPage._isLive(device);
        const conflict = DevicesPage._conflictHaName(device);
        const m = device.metrics || {};
        const locked = !!m.controls?.lock;
        const lockBusy = !!this._busyLock[device.device_id];

        const statusBadge = live
            ? '<span style="font-size: 12px;"><span class="status-dot online"></span></span>'
            : `<span style="font-size: 12px; color: var(--text-secondary);">${DevicesPage._formatTime(device.last_seen_at)} <span class="status-dot offline"></span></span>`;

        return `
            <div class="card card-clickable" onclick="DevicesPage.showDetail('${idAttr}')">
                <div class="card-body" style="padding: 12px;">
                    ${this._renderHeader(device, idAttr, icon, locked, lockBusy, statusBadge, conflict)}
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
                        ${this._renderLeftColumn(device, m)}
                        ${this._renderRightColumn(device, idAttr)}
                    </div>
                    ${this._renderFooter(device, idAttr, m)}
                </div>
            </div>
        `;
    },

    _renderHeader(device, idAttr, icon, locked, lockBusy, statusBadge, conflict) {
        const conflictChip = conflict
            ? `<span title="HA: ${DevicesPage._escape(conflict)}" style="color: var(--accent); font-size: 11px;">⚠ HA: ${DevicesPage._escape(conflict)}</span>`
            : '';
        const lockIcon = locked ? '🔒' : '🔓';
        const lockTitle = locked ? 'Tap to unlock' : 'Tap to lock';
        return `
            <div style="display: flex; align-items: flex-start; gap: 10px;">
                <div class="device-card-icon" style="flex-shrink: 0;">${icon}</div>
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 6px; font-weight: 600;">
                        <span>${DevicesPage._escape(device.device_name || 'Unnamed Device')}</span>
                        <button title="${lockTitle}" ${lockBusy ? 'disabled' : ''}
                            onclick="event.stopPropagation(); DevicesCard.toggleLock('${idAttr}', ${locked})"
                            style="background: none; border: none; cursor: ${lockBusy ? 'wait' : 'pointer'}; padding: 2px 4px; opacity: ${lockBusy ? 0.5 : 0.85}; font-size: 14px;">
                            ${lockIcon}
                        </button>
                        ${conflictChip}
                    </div>
                    <div class="device-card-type" style="margin-top: 2px;">${DevicesPage._escape(DevicesPage._typeLabel(device))}</div>
                </div>
                <div style="flex-shrink: 0; align-self: flex-start;">${statusBadge}</div>
            </div>
        `;
    },

    _renderLeftColumn(device, m) {
        const rows = [];
        if (m.battery?.level != null) {
            const icon = m.battery.charging ? '⚡' : '🔋';
            rows.push(`${icon} ${m.battery.level}%`);
        }
        if (m.network?.wifi_signal_percent != null) {
            rows.push(`📶 ${m.network.wifi_signal_percent}%`);
        }
        if (m.system?.ram_used_percent != null) {
            rows.push(`RAM ${m.system.ram_used_percent}%`);
        }
        // HA room/zone (Phase 2 will supply this; gracefully omit until then)
        const room = device.metrics?.ha_area || device.ha_area;
        if (room) rows.push(`🏠 ${DevicesPage._escape(room)}`);
        if (rows.length === 0) {
            return `<div style="font-size: var(--font-size-sm); color: var(--text-muted);">No live metrics yet</div>`;
        }
        return `
            <div style="display: flex; flex-direction: column; gap: 4px; font-size: var(--font-size-sm);">
                ${rows.map(r => `<div>${r}</div>`).join('')}
            </div>
        `;
    },

    _renderRightColumn(device, idAttr) {
        // Phase 3 wires real screenshot + camera. Placeholders for now.
        const placeholderStyle = 'background: var(--bg-muted); border: 1px dashed var(--border); border-radius: 4px; aspect-ratio: 16/9; display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--text-muted);';
        return `
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <div style="${placeholderStyle}">screenshot</div>
                <div style="${placeholderStyle}" title="Click for live stream (coming soon)">camera</div>
            </div>
        `;
    },

    _renderFooter(device, idAttr, m) {
        const items = [
            { icon: '🎵', label: 'song', tip: 'Now playing — wired in Phase 4' },
            { icon: m.presence?.motion || m.presence?.face ? '👤' : '👤', label: m.presence?.motion ? 'motion' : (m.presence?.face ? 'face' : 'idle'), tip: 'Motion / face detection' },
            { icon: m.controls?.dark_mode ? '🌙' : '☀️', label: m.controls?.dark_mode ? 'dark' : 'light', tip: 'Dark mode — toggle in Phase 4' },
            { icon: m.controls?.screen === false ? '🛏' : '⊙', label: m.controls?.screen === false ? 'off' : 'on', tip: 'Screen off — toggle in Phase 4' },
            { icon: '⟳', label: 'reload', tip: 'Reload dashboard — wired in Phase 4' },
            { icon: '🔊', label: m.controls?.volume != null ? `${m.controls.volume}` : '—', tip: 'Volume' },
            { icon: '☼', label: m.controls?.brightness != null ? `${m.controls.brightness}` : '—', tip: 'Brightness' },
        ];
        const cells = items.map(it => `
            <div title="${DevicesPage._escape(it.tip)}" style="text-align: center; font-size: 11px; color: var(--text-secondary); padding: 4px;">
                <div style="font-size: 14px;">${it.icon}</div>
                <div>${DevicesPage._escape(it.label)}</div>
            </div>
        `).join('');
        return `
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border);">
                ${cells}
            </div>
        `;
    },

    // ---- Live actions ----

    /** Toggle the device's lock switch via /api/ha/control. */
    async toggleLock(deviceId, currentlyLocked) {
        if (this._busyLock[deviceId]) return;
        this._busyLock[deviceId] = true;
        App.renderPage();
        try {
            await this.control(deviceId, 'lock', !currentlyLocked);
            // Optimistic state update so the icon flips immediately;
            // worker re-poll (triggered by the endpoint) will reconcile.
            const device = DevicesPage._findDevice(deviceId);
            if (device) {
                device.metrics = device.metrics || {};
                device.metrics.controls = device.metrics.controls || {};
                device.metrics.controls.lock = !currentlyLocked;
            }
        } catch (e) {
            console.error('[DevicesCard] lock toggle failed:', e);
            Toast.error(Toast.friendly(e, 'toggle lock'));
        } finally {
            delete this._busyLock[deviceId];
            App.renderPage();
        }
    },

    /** Generic control passthrough — used by lock now, dark/screen/volume/etc. later. */
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
