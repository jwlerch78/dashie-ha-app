/* ============================================================
   Voice & AI account-default cards (WS-G Round A)
   ------------------------------------------------------------
   The account-level defaults from Open Brain plan §13.2:

   - Default personality (brain section, under the AI Model card)
     → ai.defaultPersonalityId
   - Default voice (TTS section) → ai.defaultVoiceKey. Voice lock
     wins: a voice_mode='fixed' personality renders a locked note
     instead of the picker; 'preferred' personalities offer the
     tts_voices catalog with "Personality default (<voice>)" as
     the unset option.

   Devices follow these unless overridden on the Devices page
   (aiVoice.personalityId/voiceKey; '' / unset = follow account).
   Runtime resolution (device ?? account default) is Round B —
   these cards store settings only.

   Pure render. State + writes live on VoiceAiPage:
     VoiceAiPage.saveDefault('ai.defaultPersonalityId', v)
     VoiceAiPage.saveDefault('ai.defaultVoiceKey', v)
   ============================================================ */

const VoiceAiDefaultsCards = {
    _esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    /**
     * Default-personality card.
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
            <div class="card" style="margin-bottom: 16px;"><div class="card-body">
                <label class="form-label">Default personality ${o.saving ? '<span style="color: var(--text-muted); font-weight: 400;">· saving…</span>' : ''}</label>
                <select class="form-select" onchange="VoiceAiPage.saveDefault('ai.defaultPersonalityId', this.value)">${groups.join('')}</select>
                <div style="margin-top: 8px; font-size: 12px; color: var(--text-muted); line-height: 1.5;">
                    Used by every device on this account — a device can pick its own on the
                    <a href="#devices" onclick="event.preventDefault(); App.navigate('devices')" style="color: var(--accent);">Devices page</a>.
                    Create &amp; edit personalities on the Personalities tab.
                </div>
            </div></div>`;
    },

    /**
     * Default-voice card (Dashie Cloud TTS). Voice lock wins: fixed-voice
     * personalities show a locked note, not a picker.
     * @param {object} o { voices, currentKey, personality, saving }
     *   personality = the resolved default-personality record
     *   ({ name, voice_mode, voice }) or null.
     */
    renderVoiceCard(o) {
        const p = o.personality;
        const voiceName = (key) => {
            const v = (o.voices || []).find(x => (x.key || x.voice_key) === key);
            return v?.name || (key ? key.charAt(0) + key.slice(1).toLowerCase() : '');
        };
        if (p && p.voice_mode === 'fixed') {
            return `
                <div class="card" style="margin-bottom: 16px;"><div class="card-body">
                    <label class="form-label">Default voice</label>
                    <div style="font-size: 14px; margin-top: 2px;">
                        ${this._esc(voiceName(p.voice))}
                        <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); background: var(--bg-muted, #f4f4f5); border-radius: 999px; padding: 2px 8px; margin-left: 8px;">locked by ${this._esc(p.name || 'personality')}</span>
                    </div>
                    <div style="margin-top: 8px; font-size: 12px; color: var(--text-muted); line-height: 1.5;">
                        ${this._esc(p.name || 'This personality')} always speaks in this voice. Pick a
                        voice-flexible personality to choose freely.
                    </div>
                </div></div>`;
        }
        const preferred = p?.voice ? ` (${voiceName(p.voice)})` : '';
        const opts = [
            `<option value="" ${o.currentKey ? '' : 'selected'}>Personality default${this._esc(preferred)}</option>`,
            ...(o.voices || []).map(v => {
                const key = v.key || v.voice_key;
                const label = `${v.name || key}${v.gender ? ` · ${v.gender}` : ''}`;
                return `<option value="${this._esc(key)}" ${key === o.currentKey ? 'selected' : ''}>${this._esc(label)}</option>`;
            }),
        ].join('');
        return `
            <div class="card" style="margin-bottom: 16px;"><div class="card-body">
                <label class="form-label">Default voice ${o.saving ? '<span style="color: var(--text-muted); font-weight: 400;">· saving…</span>' : ''}</label>
                <select class="form-select" onchange="VoiceAiPage.saveDefault('ai.defaultVoiceKey', this.value)">${opts}</select>
                <div style="margin-top: 8px; font-size: 12px; color: var(--text-muted); line-height: 1.5;">
                    The voice devices speak in (Dashie Cloud voices). Devices can override it on the Devices page.
                </div>
            </div></div>`;
    },
};

window.VoiceAiDefaultsCards = VoiceAiDefaultsCards;
