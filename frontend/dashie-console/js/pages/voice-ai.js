/* ============================================================
   Voice & AI page (stub — populated in a follow-up).
   Will host cross-device voice pipeline settings: STT/TTS providers,
   AI model, customize-pipeline, response handling, sample collection
   consent. Wake word + sensitivity stay per-device on the device card.
   ============================================================ */

const VoiceAiPage = {
    render() {
        return `
            <div class="empty-state" style="margin-top: 80px;">
                <div class="empty-state-icon">🎙️</div>
                <div class="empty-state-text">Voice &amp; AI settings — coming soon.</div>
                <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: 8px; max-width: 480px; margin-left: auto; margin-right: auto;">
                    Configure your voice pipeline (STT, TTS, AI model) once and apply across all devices.
                    Wake word and sensitivity remain per-device on the Devices page.
                </div>
            </div>
        `;
    },
    topBarTitle() { return 'Voice & AI'; },
    topBarSubtitle() { return 'Cross-device voice pipeline settings'; },
};
