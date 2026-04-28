/* ============================================================
   Devices Camera modal — fetches HA's HLS stream URL via the add-on,
   plays it via hls.js (or native HLS on Safari) in a <video> element.
   Same source HA's more-info dialog uses.
   ============================================================ */

const DevicesCamera = {
    _open: null,  // { deviceId, loading, error?, hlsUrl? }
    _hls: null,   // hls.js instance for cleanup

    async open(deviceId) {
        if (!DashieAuth.isAddonMode) return;
        this._open = { deviceId, loading: true, error: null };
        App.renderPage();
        try {
            const resp = await fetch(DashieAuth._addonUrl(`/api/ha/stream/${encodeURIComponent(deviceId)}`));
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const info = await resp.json();
            if (this._open?.deviceId !== deviceId) return;
            Object.assign(this._open, { hlsUrl: info.hls_url, loading: false });
            App.renderPage();
            setTimeout(() => this._attach(info.hls_url), 0);
        } catch (e) {
            console.error('[DevicesCamera] stream resolve failed:', e);
            if (this._open?.deviceId === deviceId) {
                Object.assign(this._open, { error: e.message, loading: false });
                App.renderPage();
            }
        }
    },

    close() {
        if (this._hls) { try { this._hls.destroy(); } catch {} this._hls = null; }
        this._open = null;
        App.renderPage();
    },

    _maybeClose(e) { if (e.target === e.currentTarget) this.close(); },

    _attach(url) {
        const video = document.getElementById('devices-camera-modal-video');
        if (!video) return;
        if (this._hls) { try { this._hls.destroy(); } catch {} this._hls = null; }
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url; video.play().catch(() => {});
        } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            const hls = new Hls({ lowLatencyMode: true, backBufferLength: 30 });
            hls.loadSource(url); hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
            this._hls = hls;
        } else { video.src = url; }
    },

    render() {
        const m = this._open;
        if (!m) return '';
        const name = (DevicesPage._findDevice(m.deviceId)?.device_name || 'Camera') + ' · Live';
        const body = m.loading
            ? `<div style="color: white; padding: 80px 0; text-align: center;">Loading stream…</div>`
            : m.error
                ? `<div style="color: #f87171; padding: 80px 0; text-align: center;">Stream failed: ${DevicesPage._escape(m.error)}</div>`
                : `<video id="devices-camera-modal-video" autoplay muted playsinline controls style="max-width: 95vw; max-height: 80vh; border-radius: 6px; background: #000;"></video>`;
        return `
            <div onclick="DevicesCamera._maybeClose(event)" style="position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 24px; cursor: zoom-out;">
                <div onclick="event.stopPropagation()" style="max-width: 95vw; max-height: 92vh; display: flex; flex-direction: column; gap: 10px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; color: white;">
                        <strong>${DevicesPage._escape(name)}</strong>
                        <button onclick="DevicesCamera.close()" style="background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.25); border-radius: 4px; padding: 4px 12px; cursor: pointer;">Close</button>
                    </div>
                    ${body}
                </div>
            </div>
        `;
    },
};
