/* ============================================================
   Voice & AI account-default cards (WS-G Round A)
   ------------------------------------------------------------
   Account-level defaults from Open Brain plan §13.2:

   - Default personality (brain section, under the AI Model card)
     → ai.defaultPersonalityId. Compact single-row card (label +
     inline dropdown — 2026-07-12 vertical-compression pass).

   The account default-VOICE picker was removed (John, 2026-07-12):
   the Dashie Cloud / ElevenLabs voice follows the personality —
   no independent account voice choice. ai.defaultVoiceKey still
   exists ('' = personality's preferred voice) and the per-device
   Voice override lives on the Devices page.

   Devices follow the defaults unless overridden on the Devices
   page (aiVoice.personalityId/voiceKey; '' / unset = follow
   account). Runtime resolution (device ?? account default) is
   Round B — this card stores settings only.

   Pure render. State + writes live on VoiceAiPage:
     VoiceAiPage.saveDefault('ai.defaultPersonalityId', v)
   ============================================================ */

const VoiceAiDefaultsCards = {
    _esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    /**
     * Default-personality row — matches the collapsed pipeline-card row style
     * (caps label left, control right).
     * @param {object} o { templates, custom, currentId, saving }
     */
    renderPersonalityCard(o) {
        const groups = [];
        const opt = (v, l) => `<option value="${this._esc(v)}" ${String(v) === String(o.currentId) ? 'selected' : ''}>${this._esc(l)}</option>`;
        const customOpts = (o.custom || []).map(c => opt(c.id, c.name || 'Custom personality')).join('');
        if (customOpts) groups.push(`<optgroup label="Custom">${customOpts}</optgroup>`);
        const templateOpts = (o.templates || []).map(t => opt(t.key || t.id, t.name || t.key)).join('');
        groups.push(`<optgroup label="Built-in">${templateOpts}</optgroup>`);
        return `
            <div class="card" style="margin-bottom: 10px;"><div class="card-body" style="display: flex; align-items: center; gap: 10px; padding: 8px 14px;">
                <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); min-width: 150px;">Default personality ${o.saving ? '<span style="font-weight: 400; text-transform: none;">· saving…</span>' : ''}</span>
                <select class="form-select" style="flex: 1;" onchange="VoiceAiPage.saveDefault('ai.defaultPersonalityId', this.value)">${groups.join('')}</select>
            </div></div>`;
    },
};

window.VoiceAiDefaultsCards = VoiceAiDefaultsCards;
