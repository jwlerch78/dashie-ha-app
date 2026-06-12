/* ============================================================
   Devices Camera — embeds HA's own more-info dialog via iframe
   ------------------------------------------------------------
   The Dashie HA integration declares
       _attr_frontend_stream_type = StreamType.HLS
   which makes HA's frontend wrap the camera entity in its native
   <ha-hls-player> component. That component already handles
   manifest fetch, token refresh, recovery on error, autoplay
   gestures, segment buffering — none of which our previous
   inline Hls.js wrapper replicated, hence the black video element.

   Since the Console is served from HA Ingress, we're same-origin
   with HA. Iframing HA's URL with ?more-info-entity-id=<entity>
   gets us HA's exact viewer with zero extra work. The dashboard
   loads briefly behind the dialog; our modal frame sized to
   95vw × 90vh covers most of the chrome, and the dialog itself
   centers on top.

   Why iframe instead of popup (previous approach):
     - window.open in a sandboxed iframe is hit-or-miss
     - HA's SPA routing preserves the query string when navigated
       client-side, but a popup's `location.href = '/?…'` triggers
       a server hit + redirect that strips the query.
     - Iframe load is in-page, no popup-blocker.
   ============================================================ */

const DevicesCamera = {
    /** Modal state. null when closed. Shape:
     *  { deviceId, entityId, dashboardPath, error, loading } */
    _open: null,
    _openSeq: 0,

    async open(deviceId) {
        if (!DashieAuth.isAddonMode) return;
        const seq = ++this._openSeq;
        this._open = { deviceId, entityId: null, dashboardPath: null, error: null, loading: true };
        App.renderPage();

        try {
            // /api/ha/stream is the existing endpoint that resolves the
            // camera entity for a Dashie device_id. We only need the
            // entity_id; the iframe drives playback through HA's UI.
            const resp = await fetch(DashieAuth._addonUrl(`/api/ha/stream/${encodeURIComponent(deviceId)}`));
            if (!resp.ok) {
                const body = await resp.json().catch(() => ({}));
                throw new Error(body.message || body.error || `HTTP ${resp.status}`);
            }
            const info = await resp.json();
            if (this._openSeq !== seq || !this._open) return;
            // dashboardPath: prefer the user's default dashboard slug if the
            // add-on resolved one (avoids the / → /home/overview redirect that
            // strips the query string on some HA setups). Falls back to '/'
            // and lets HA's client-side SPA routing carry the query through.
            this._open.entityId = info.entity_id;
            this._open.dashboardPath = info.dashboard_path || '/';
            this._open.loading = false;
            App.renderPage();
        } catch (e) {
            if (this._openSeq !== seq || !this._open) return;
            console.error('[DevicesCamera] resolve failed:', e);
            this._open.error = e.message || String(e);
            this._open.loading = false;
            App.renderPage();
        }
    },

    close() {
        this._open = null;
        App.renderPage();
    },

    /**
     * Strip HA's dashboard chrome from inside the iframe so only the
     * more-info dialog is visible. Console is same-origin with HA (we're
     * served from Ingress), so cross-iframe scripting is allowed.
     *
     * <home-assistant-main> wraps the sidebar + dashboard content; HA
     * dialogs are mounted to <home-assistant> as siblings, outside of
     * <home-assistant-main>. Hiding <home-assistant-main> + the scrim
     * leaves just the floating dialog over a transparent backdrop.
     *
     * Called from the iframe's onload via inline attribute below. Also
     * re-runs on a short interval for ~3s in case the dialog opens
     * after the SPA boot (some HA versions stage the dialog open in a
     * microtask after the route handler fires).
     */
    _stripChrome(iframe) {
        // HA's <home-assistant> and <home-assistant-main> both use shadow
        // DOM. CSS injected into the document head doesn't cross shadow
        // boundaries — it has to be appended into each shadow root that
        // hosts the chrome we want to hide. Same-origin iframes give us
        // full DOM access including shadow roots (assuming they're "open"
        // mode, which HA's are).
        //
        // The structure looks roughly like:
        //   document
        //     <home-assistant>             ← shadow root
        //       <home-assistant-main>      ← shadow root
        //         <ha-drawer>              (sidebar)
        //         <partial-panel-resolver> (dashboard content)
        //         <ha-more-info-dialog>    (open dialog)
        //
        // We inject a style into <home-assistant-main>'s shadow root to
        // hide everything except the more-info dialog. Also drop a few
        // global rules into document.head as backstop in case structure
        // varies across HA versions.
        const inject = () => {
            try {
                const doc = iframe.contentDocument;
                if (!doc) return false;

                // Global / document-level styles (transparent scrim + body).
                if (!doc.getElementById('dashie-camera-strip')) {
                    const style = doc.createElement('style');
                    style.id = 'dashie-camera-strip';
                    style.textContent = `
                        :root, body { background: transparent !important; }
                        .mdc-dialog__scrim { background: transparent !important; }
                    `;
                    doc.head.appendChild(style);
                }

                // Reach into <home-assistant-main>'s shadow DOM. Walk both
                // shadow boundaries: <home-assistant> → <home-assistant-main>.
                const haRoot = doc.querySelector('home-assistant');
                const haShadow = haRoot?.shadowRoot;
                if (!haShadow) return false;
                const main = haShadow.querySelector('home-assistant-main');
                const mainShadow = main?.shadowRoot;
                if (!mainShadow) return false;

                if (!mainShadow.getElementById('dashie-camera-strip-shadow')) {
                    const style = doc.createElement('style');
                    style.id = 'dashie-camera-strip-shadow';
                    style.textContent = `
                        /* Sidebar, header, dashboard content — gone.
                           Leave dialogs visible (they're siblings here). */
                        ha-drawer, mwc-drawer, .mdc-drawer { display: none !important; }
                        partial-panel-resolver, .main-content,
                        app-toolbar, .toolbar, app-header, mwc-top-app-bar-fixed {
                            display: none !important;
                        }
                    `;
                    mainShadow.appendChild(style);
                }
                return true;
            } catch (e) {
                console.warn('[DevicesCamera] strip failed', e);
                return false;
            }
        };

        if (inject()) return;
        // Retry every 100ms for up to 5s in case the SPA boots after the
        // iframe load event fires (shadow roots aren't there until then).
        const start = performance.now();
        const tick = () => {
            if (inject()) return;
            if (performance.now() - start > 5000) return;
            setTimeout(tick, 100);
        };
        setTimeout(tick, 50);
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

        // The iframe src: HA's default dashboard (or '/'') with the
        // ?more-info-entity-id query that HA's frontend uses to open
        // the camera dialog automatically. Same-origin so no auth issue;
        // HA cookie is present from the parent context.
        const iframeSrc = m.entityId
            ? `${m.dashboardPath || '/'}?more-info-entity-id=${encodeURIComponent(m.entityId)}`
            : '';

        let body;
        if (m.error) {
            body = `
                <div style="display: flex; align-items: center; justify-content: center; min-height: 320px; background: #111; color: #fca5a5; padding: 24px; text-align: center; border-radius: 6px;">
                    Could not open camera viewer: ${DevicesPage._escape(m.error)}
                </div>`;
        } else if (m.loading || !iframeSrc) {
            body = `
                <div style="display: flex; align-items: center; justify-content: center; min-height: 320px; background: #111; color: #d1d5db; border-radius: 6px;">
                    Loading camera…
                </div>`;
        } else {
            // 90vh iframe with a dark backdrop covers the dashboard chrome
            // that briefly flashes behind HA's dialog. Border-radius matches
            // other modal panels for visual consistency.
            body = `
                <iframe src="${iframeSrc}" allow="autoplay; fullscreen"
                    onload="DevicesCamera._stripChrome(this)"
                    style="width: 95vw; height: 88vh; border: 0; background: transparent; border-radius: 6px;">
                </iframe>`;
        }

        const footer = m.entityId
            ? `<div style="color: rgba(255,255,255,0.55); font-size: 11px; text-align: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${escEntity}</div>`
            : '';

        return `
            <div onclick="DevicesCamera._maybeCloseBackdrop(event)"
                 style="position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 16px; cursor: zoom-out;">
                <div onclick="event.stopPropagation()"
                     style="display: flex; flex-direction: column; gap: 8px; cursor: default;">
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
