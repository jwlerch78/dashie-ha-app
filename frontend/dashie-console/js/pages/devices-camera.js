/* ============================================================
   Devices Camera modal — embeds HA's own UI for the camera entity
   in an iframe so we use HA's exact <ha-hls-player> code path
   (same one the integration page uses, which we know works).

   Why an iframe instead of our own <video>+hls.js: rebuilding HA's
   player against arbitrary HA stream backends produced version-
   sensitive bufferAppend errors that HA's own player handles. Rather
   than chase parity, we just embed HA's UI directly.
   ============================================================ */

const DevicesCamera = {
    _open: null,  // { deviceId, loading, error?, entityId? }

    async open(deviceId) {
        if (!DashieAuth.isAddonMode) return;
        this._open = { deviceId, loading: true, error: null };
        App.renderPage();
        try {
            // /api/ha/stream resolves the deviceId → HA camera entity_id (and
            // also kicks off the stream pipeline in HA, same as the integration
            // page's "play" click). We only need the entity_id from the response.
            const resp = await fetch(DashieAuth._addonUrl(`/api/ha/stream/${encodeURIComponent(deviceId)}`));
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const info = await resp.json();
            if (this._open?.deviceId !== deviceId) return;
            Object.assign(this._open, { entityId: info.entity_id, loading: false });
            App.renderPage();
        } catch (e) {
            console.error('[DevicesCamera] resolve failed:', e);
            if (this._open?.deviceId === deviceId) {
                Object.assign(this._open, { error: e.message, loading: false });
                App.renderPage();
            }
        }
    },

    close() {
        this._open = null;
        App.renderPage();
    },

    _maybeClose(e) { if (e.target === e.currentTarget) this.close(); },

    render() {
        const m = this._open;
        if (!m) return '';
        const name = (DevicesPage._findDevice(m.deviceId)?.device_name || 'Camera') + ' · Live';
        // HA's overview dashboard with a more-info dialog for the entity opens
        // the same camera view the integration page uses. Same origin as us
        // (we're inside HA Ingress), so the iframe inherits HA's session
        // cookie and HA's <ha-hls-player> runs natively inside it.
        const haPath = m.entityId ? `/lovelace/0?more-info-entity-id=${encodeURIComponent(m.entityId)}` : null;
        const frameSize = 'width: 90vw; max-width: 1200px; height: 80vh; border: 0; border-radius: 6px; background: #fff;';
        const body = m.loading
            ? `<div style="${frameSize} display: flex; align-items: center; justify-content: center; color: white; font-size: 14px; background: #111;">Loading…</div>`
            : m.error
                ? `<div style="${frameSize} display: flex; align-items: center; justify-content: center; color: #f87171; font-size: 14px; padding: 24px; box-sizing: border-box; background: #111;">Stream failed: ${DevicesPage._escape(m.error)}</div>`
                : `<iframe src="${haPath}" style="${frameSize}" allow="autoplay; fullscreen; encrypted-media"></iframe>`;
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
