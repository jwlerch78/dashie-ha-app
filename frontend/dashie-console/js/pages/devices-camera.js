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

    /**
     * Replicates HA's ha-hls-player.ts approach as closely as possible:
     *  - Pre-fetch the master playlist, extract the single variant playlist URL
     *    so hls.js doesn't have to parse the master itself.
     *  - hls.js config copied from HA's player (longer timeouts, no LL-HLS by
     *    default, larger backBufferLength).
     *  - attachMedia → on MEDIA_ATTACHED, loadSource (HA's order).
     *  - Recover from MEDIA / NETWORK errors before treating as fatal.
     */
    async _attach(url) {
        const video = document.getElementById('devices-camera-modal-video');
        if (!video) return;
        if (this._hls) { try { this._hls.destroy(); } catch {} this._hls = null; }
        console.log('[DevicesCamera] attaching HLS:', url);

        // Pre-fetch master playlist and extract the variant URL (HA pattern).
        let playlistUrl = url;
        try {
            const txt = await (await fetch(url)).text();
            const re = /#EXT-X-STREAM-INF:.*?(?:\n|\r\n)(.+)/g;
            const m1 = re.exec(txt);
            const m2 = re.exec(txt);
            if (m1 && !m2) playlistUrl = new URL(m1[1].trim(), new URL(url, location.href)).href;
        } catch (e) {
            console.warn('[DevicesCamera] master pre-fetch failed; falling back to master URL:', e.message);
        }

        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            const hls = new Hls({
                backBufferLength: 60,
                fragLoadingTimeOut: 30000,
                manifestLoadingTimeOut: 30000,
                levelLoadingTimeOut: 30000,
                maxLiveSyncPlaybackRate: 2,
                lowLatencyMode: false,  // HA only enables this with http/2; safe default off.
            });
            this._hls = hls;
            hls.attachMedia(video);
            hls.on(Hls.Events.MEDIA_ATTACHED, () => {
                console.log('[DevicesCamera] media attached; loading source:', playlistUrl);
                hls.loadSource(playlistUrl);
            });
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('[DevicesCamera] manifest parsed');
            });
            // Standard hls.js 2-stage media recovery: first try recoverMediaError,
            // if that fails again within 3s try swapAudioCodec + recoverMediaError,
            // then give up. Without escalation we'd just loop on the same error
            // forever (which is what we were seeing: bufferAppendError on repeat).
            let recoverDecodeAt = 0, recoverSwapAt = 0;
            const recoverMedia = () => {
                const now = performance.now();
                if (now - recoverDecodeAt > 3000) {
                    recoverDecodeAt = now;
                    console.log('[DevicesCamera] recovering media error (attempt 1)');
                    hls.recoverMediaError();
                } else if (now - recoverSwapAt > 3000) {
                    recoverSwapAt = now;
                    console.log('[DevicesCamera] swapAudioCodec + recover (attempt 2)');
                    hls.swapAudioCodec();
                    hls.recoverMediaError();
                } else {
                    console.warn('[DevicesCamera] media recovery exhausted; giving up');
                    if (this._open) {
                        Object.assign(this._open, { error: 'Stream playback error (codec)' });
                        App.renderPage();
                    }
                    try { hls.destroy(); } catch {}
                }
            };
            hls.on(Hls.Events.ERROR, (_evt, data) => {
                if (!data?.fatal) {
                    console.log('[DevicesCamera] hls.js (non-fatal):', data?.type, data?.details);
                    return;
                }
                console.warn('[DevicesCamera] hls.js fatal:', data.type, data.details);
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    hls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    recoverMedia();
                } else if (this._open) {
                    Object.assign(this._open, { error: `${data.type}: ${data.details || 'unknown'}` });
                    App.renderPage();
                }
            });
            // Play once metadata is loaded (HA pattern: loadeddata).
            video.addEventListener('loadeddata', () => {
                video.play().catch(err => console.warn('[DevicesCamera] play failed:', err));
            }, { once: true });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Last-resort native HLS for browsers without MSE (iOS Safari).
            console.log('[DevicesCamera] hls.js unavailable; using native HLS');
            video.src = playlistUrl;
            video.addEventListener('loadedmetadata', () => video.play().catch(() => {}), { once: true });
        } else {
            if (this._open) {
                Object.assign(this._open, { error: 'No HLS player available in this browser' });
                App.renderPage();
            }
        }
    },

    render() {
        const m = this._open;
        if (!m) return '';
        const name = (DevicesPage._findDevice(m.deviceId)?.device_name || 'Camera') + ' · Live';
        // Give the video element a real size while waiting for the stream so the
        // modal doesn't collapse to a tiny default-controls box.
        const videoSize = 'width: 80vw; max-width: 1200px; aspect-ratio: 16/9; max-height: 80vh; border-radius: 6px; background: #000;';
        const body = m.loading
            ? `<div style="${videoSize} display: flex; align-items: center; justify-content: center; color: white; font-size: 14px;">Loading stream…</div>`
            : m.error
                ? `<div style="${videoSize} display: flex; align-items: center; justify-content: center; color: #f87171; font-size: 14px; padding: 24px; box-sizing: border-box;">Stream failed: ${DevicesPage._escape(m.error)}</div>`
                : `<video id="devices-camera-modal-video" autoplay muted playsinline controls style="${videoSize} object-fit: contain; display: block;"></video>`;
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
