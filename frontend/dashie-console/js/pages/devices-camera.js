/* ============================================================
   Devices Camera — inline HLS player modal
   ------------------------------------------------------------
   Plays the device's camera stream using HA's signed HLS URL
   (the exact one HA's <ha-hls-player> uses internally). Same
   stream source as the integration page; no popup, no nested
   HA UI to fight, no extra navigation.

   Flow:
     1. open(deviceId) — synchronously sets _open and re-renders
        so the modal frame appears immediately ("Loading…").
     2. /api/ha/stream/:deviceId resolves to { entity_id, hls_url }.
     3. _attachPlayer() finds the <video> element and either uses
        native HLS (Safari) or hls.js (Chrome / Firefox / Edge).
     4. close() destroys the Hls instance and clears state.

   Hls.js is loaded once at app boot from a CDN pin matching
   HA's frontend (see index.html). Version drift was producing
   bufferAppendError on streams that play fine in HA's UI.
   ============================================================ */

const DevicesCamera = {
    /** Modal state. null when closed. Shape:
     *  { deviceId, entityId, hlsUrl, error, loading } */
    _open: null,
    /** Active Hls.js instance (null on Safari / native HLS). */
    _hls: null,
    /** Increments per open() so a late-arriving fetch from a previous
     *  open() can't clobber a fresh modal. */
    _openSeq: 0,

    async open(deviceId) {
        if (!DashieAuth.isAddonMode) return;
        const seq = ++this._openSeq;
        this._open = { deviceId, entityId: null, hlsUrl: null, error: null, loading: true };
        App.renderPage();

        let info;
        try {
            const resp = await fetch(DashieAuth._addonUrl(`/api/ha/stream/${encodeURIComponent(deviceId)}`));
            if (!resp.ok) {
                const body = await resp.json().catch(() => ({}));
                throw new Error(body.message || body.error || `HTTP ${resp.status}`);
            }
            info = await resp.json();
        } catch (e) {
            if (this._openSeq !== seq || !this._open) return;
            console.error('[DevicesCamera] resolve failed:', e);
            this._open.error = e.message || String(e);
            this._open.loading = false;
            App.renderPage();
            return;
        }

        if (this._openSeq !== seq || !this._open) return;
        this._open.entityId = info.entity_id;
        this._open.hlsUrl = info.hls_url;
        this._open.loading = false;
        App.renderPage();

        // Wait for the <video> element to land in the DOM before binding.
        setTimeout(() => this._attachPlayer(seq), 0);
    },

    _attachPlayer(seq) {
        if (this._openSeq !== seq || !this._open?.hlsUrl) return;
        const video = document.getElementById('dashie-camera-video');
        if (!video) {
            // Re-render may not have flushed yet — retry once.
            setTimeout(() => this._attachPlayer(seq), 50);
            return;
        }
        const src = this._open.hlsUrl;
        // Safari and iOS WebView play HLS natively from <video src>.
        // Hls.js (where loaded) wraps non-native browsers via MSE.
        const canNativeHls = video.canPlayType('application/vnd.apple.mpegurl');
        if (canNativeHls) {
            video.src = src;
            video.play().catch(() => { /* user-gesture fallback handled by controls */ });
            return;
        }
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            this._destroyHls();
            this._hls = new Hls({ liveSyncDuration: 3, liveMaxLatencyDuration: 6 });
            this._hls.attachMedia(video);
            this._hls.on(Hls.Events.MEDIA_ATTACHED, () => this._hls.loadSource(src));
            this._hls.on(Hls.Events.ERROR, (_evt, data) => {
                if (!data?.fatal) return;
                console.error('[DevicesCamera] HLS fatal:', data);
                if (!this._open) return;
                this._open.error = `Stream error (${data.type || 'unknown'})`;
                App.renderPage();
            });
            video.play().catch(() => { /* autoplay may need user gesture */ });
            return;
        }
        // No HLS support at all — fall back to the src attribute and let
        // the browser try; if it can't, the user gets the browser's error.
        video.src = src;
    },

    _destroyHls() {
        if (!this._hls) return;
        try { this._hls.destroy(); } catch (e) { /* ignore */ }
        this._hls = null;
    },

    close() {
        this._destroyHls();
        this._open = null;
        App.renderPage();
    },

    _maybeCloseBackdrop(e) {
        if (e.target === e.currentTarget) this.close();
    },

    render() {
        const m = this._open;
        if (!m) return '';
        const device = DevicesPage._findDevice(m.deviceId);
        const name = device?.device_name || 'Camera';
        const escName = DevicesPage._escape(name);
        const escEntity = DevicesPage._escape(m.entityId || '');

        let body;
        if (m.error) {
            body = `
                <div style="display: flex; align-items: center; justify-content: center; min-height: 320px; background: #111; color: #fca5a5; padding: 24px; text-align: center; border-radius: 6px;">
                    Could not start stream: ${DevicesPage._escape(m.error)}
                </div>`;
        } else if (m.loading || !m.hlsUrl) {
            body = `
                <div style="display: flex; align-items: center; justify-content: center; min-height: 320px; background: #111; color: #d1d5db; border-radius: 6px;">
                    Loading camera…
                </div>`;
        } else {
            body = `
                <video id="dashie-camera-video"
                       controls autoplay muted playsinline
                       style="max-width: 95vw; max-height: 80vh; background: #000; border-radius: 6px;">
                </video>`;
        }

        const footer = m.entityId
            ? `<div style="color: rgba(255,255,255,0.55); font-size: 11px; text-align: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${escEntity}</div>`
            : '';

        return `
            <div onclick="DevicesCamera._maybeCloseBackdrop(event)"
                 style="position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 24px; cursor: zoom-out;">
                <div onclick="event.stopPropagation()"
                     style="max-width: 95vw; max-height: 92vh; display: flex; flex-direction: column; gap: 10px; cursor: default;">
                    <div style="display: flex; align-items: center; justify-content: space-between; color: white;">
                        <strong>${escName}</strong>
                        <button onclick="DevicesCamera.close()"
                            style="background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.25); border-radius: 4px; padding: 4px 12px; cursor: pointer;">Close</button>
                    </div>
                    ${body}
                    ${footer}
                </div>
            </div>
        `;
    },
};
