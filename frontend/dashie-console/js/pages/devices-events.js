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

    _onMessage(e) {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type !== 'state' || !msg.device_id || !msg.role) return;
        DevicesPage._applyLiveOverride(msg);
        // Debounced re-render: bursts of events (e.g. screen turning off triggers
        // multiple state_changed at once) collapse to a single render.
        if (this._renderTimer) return;
        this._renderTimer = setTimeout(() => {
            this._renderTimer = null;
            App.renderPage();
        }, 80);
    },
};
