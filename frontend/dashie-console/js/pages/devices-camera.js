/* ============================================================
   Devices Camera — opens HA's UI in a popup window so we use HA's
   exact <ha-hls-player> code path (same one HA's integration page
   uses, which the user confirmed works reliably).

   Why a popup instead of an inline iframe: HA's frontend, when loaded
   in an iframe with a deep-link to a more-info dialog, navigates the
   iframe to the dashboard and opens the dialog there — but the user
   sees the whole dashboard around the dialog. The integration page
   itself uses a popup; mirroring that gives the cleanest UX.

   render() is kept as a no-op so existing callers in devices.js still
   work; there's no in-page modal anymore — the popup is its own window.
   ============================================================ */

const DevicesCamera = {
    _open: null,  // legacy field, kept so existing render-suppression checks
                  // in devices-events.js / devices.js continue to be no-ops.

    async open(deviceId) {
        if (!DashieAuth.isAddonMode) return;
        // Open popup synchronously inside the click handler so the browser's
        // popup blocker treats it as user-initiated. We navigate to about:blank
        // first and update the location once we've resolved the camera entity.
        const popup = window.open('about:blank', `dashie-camera-${deviceId}`,
            'width=1000,height=700,resizable=yes,scrollbars=yes');
        if (!popup) {
            if (typeof Toast !== 'undefined') {
                Toast.error('Popup blocked — allow popups for this site to view the camera.');
            }
            return;
        }
        // Loading hint inside the popup so it doesn't sit blank during the fetch.
        try {
            popup.document.write('<title>Loading camera…</title><body style="font-family: sans-serif; padding: 24px; color: #555;">Loading camera…</body>');
        } catch {}
        try {
            const resp = await fetch(DashieAuth._addonUrl(`/api/ha/stream/${encodeURIComponent(deviceId)}`));
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const info = await resp.json();
            if (popup.closed) return;
            // HA's overview dashboard with a more-info dialog opens the same
            // camera viewer the integration page uses. The popup is at HA's
            // origin (we're inside HA Ingress), so the session cookie is
            // present and HA's <ha-hls-player> runs in HA's normal frontend.
            popup.location.href = `/lovelace/0?more-info-entity-id=${encodeURIComponent(info.entity_id)}`;
        } catch (e) {
            console.error('[DevicesCamera] resolve failed:', e);
            if (!popup.closed) {
                try {
                    popup.document.body.innerHTML = `<p style="color: #b91c1c;">Could not start stream: ${String(e.message || e)}</p>`;
                } catch {}
            }
        }
    },

    // No-op — there's no inline modal anymore. Kept so devices.js's
    // ${DevicesCard.renderCameraModal()} call (which delegates here) is safe.
    render() { return ''; },
};
