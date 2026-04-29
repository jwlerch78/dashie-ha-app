/* ============================================================
   Devices live events — SSE client.
   ------------------------------------------------------------
   Connects to /api/ha/events and listens for HA state_changed events
   (forwarded by the add-on, enriched with {device_id, role, state}).
   Updates DevicesPage._liveOverrides so cards re-render with fresh data
   immediately. Re-render is debounced to ~80ms so a burst of events
   doesn't cause render storms.
   ============================================================ */

const DevicesEvents = {
    _es: null,
    _renderTimer: null,

    start() {
        if (this._es || !DashieAuth.isAddonMode) return;
        const url = DashieAuth._addonUrl('/api/ha/events');
        try {
            this._es = new EventSource(url);
            this._es.onmessage = (e) => this._onMessage(e);
            this._es.onerror = (e) => {
                // EventSource auto-reconnects; nothing to do here unless we need a UI hint.
                if (this._es?.readyState === EventSource.CLOSED) {
                    console.warn('[DevicesEvents] connection closed');
                }
            };
        } catch (e) {
            console.warn('[DevicesEvents] start failed:', e.message);
        }
    },

    stop() {
        if (this._es) { this._es.close(); this._es = null; }
        if (this._renderTimer) { clearTimeout(this._renderTimer); this._renderTimer = null; }
    },

    // Roles whose state changes should re-render the cards. Battery / RAM /
    // wifi_signal etc. update every few seconds in HA — re-rendering on each
    // tears down all <img> elements (screenshot, camera) and causes visible
    // flashing. Those numeric values still update internally via
    // _applyLiveOverride and surface on the next render that fires for some
    // other reason (or via the 30s auto-refresh hash diff).
    STRUCTURAL_ROLES: new Set([
        'motion_detected', 'face_detected',
        'lock', 'screen', 'screensaver', 'screensaver_active',
        'dark_mode', 'keep_screen_on', 'auto_brightness',
        'volume', 'brightness',
        'camera', 'camera_stream_url', 'rtsp_stream', 'camera_stream_enabled',
    ]),

    _onMessage(e) {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type !== 'state' || !msg.device_id || !msg.role) return;
        DevicesPage._applyLiveOverride(msg);
        if (DevicesCamera._open) return;
        // Only re-render for state changes that visibly affect the card. All
        // other override changes accumulate silently and surface on next render.
        if (!this.STRUCTURAL_ROLES.has(msg.role)) return;
        if (this._renderTimer) return;
        this._renderTimer = setTimeout(() => {
            this._renderTimer = null;
            if (DevicesCamera._open) return;
            App.renderPage();
        }, 250);
    },
};
