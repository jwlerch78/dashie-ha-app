/* ============================================================
   Video Feeds page (stub — populated in a follow-up).
   Will aggregate camera streams across all Dashie devices into a
   single grid view for monitoring + recording management.
   ============================================================ */

const VideoFeedsPage = {
    render() {
        return `
            <div class="empty-state" style="margin-top: 80px;">
                <div class="empty-state-icon">📹</div>
                <div class="empty-state-text">Video Feeds — coming soon.</div>
                <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: 8px; max-width: 480px; margin-left: auto; margin-right: auto;">
                    A unified grid of all your Dashie device camera feeds. Live previews,
                    motion alerts, and recording controls.
                </div>
            </div>
        `;
    },
    topBarTitle() { return 'Video Feeds'; },
    topBarSubtitle() { return 'Live camera feeds across all devices'; },
};
