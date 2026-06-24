/* ============================================================
   Voice & AI component cards
   ------------------------------------------------------------
   Renders one expandable "component card" for a pipeline stage
   (AI Model / Speech-to-text / Text-to-speech / Web search source).

   Collapsed: shows only the selected option (+ a "Change" button).
   Expanded:  shows every option as a selectable row.

   Each row: a colored Cloud/Local tag (orange/green, NO icons),
   the option name, its cost + description, a selected ✓, and — when
   selected and the option declares configFields — inline inputs
   (e.g. Local-LLM endpoint, SearXNG URL).

   Pure render. All state (which card is expanded, current values)
   lives in VoiceAiPage; selection + field edits call back into it:
     VoiceAiPage.selectOption(stageKey, id)
     VoiceAiPage.saveLocalField(dottedKey, value)
     VoiceAiPage.toggleCard(stageKey)
   ============================================================ */

const VoiceAiCards = {
    _esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    /** @param {object} o options: { title, stageKey, options[], selectedId, expanded, getConfig(key) } */
    render(o) {
        const O = window.VoiceAiOptions;
        const opts = o.options || [];
        const sel = opts.find(x => x.id === o.selectedId) || opts[0];
        if (!sel) return '';

        const rows = o.expanded
            ? opts.map((x, i) => this._row(x, x.id === o.selectedId, o.stageKey, o.getConfig, i === 0)).join('')
            : this._row(sel, true, o.stageKey, o.getConfig, true);

        const changeBtn = opts.length > 1
            ? `<button class="btn btn-ghost btn-sm" onclick="VoiceAiPage.toggleCard('${o.stageKey}')">${o.expanded ? 'Done' : 'Change'}</button>`
            : '';

        return `
            <div style="margin-bottom: 16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
                    <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">${this._esc(o.title)}</span>
                    ${changeBtn}
                </div>
                <div class="card"><div class="card-body" style="padding: 0;">
                    ${rows}
                </div></div>
            </div>`;
    },

    _row(x, selected, stageKey, getConfig, isFirst) {
        const O = window.VoiceAiOptions;
        const color = O.COLOR[x.locality] || 'var(--text-muted)';
        const localityTag = `<span style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:${color};">${O.LABEL[x.locality] || ''}</span>`;
        const soon = x.comingSoon
            ? `<span style="font-size:10px; font-weight:600; color: var(--text-muted); background: var(--bg-muted, #f1f1f3); padding: 1px 6px; border-radius: 9px;">coming soon</span>`
            : '';
        const check = selected ? `<span style="color: var(--accent); font-weight: 700;">✓</span>` : '';
        const config = (selected && x.configFields) ? this._config(x, getConfig) : '';
        const topBorder = isFirst ? '' : 'border-top: 1px solid var(--border, #e5e7eb);';

        return `
            <div onclick="VoiceAiPage.selectOption('${stageKey}', '${this._esc(x.id)}')"
                style="cursor: pointer; padding: 12px 14px; ${topBorder} border-left: 3px solid ${selected ? color : 'transparent'};">
                <div style="display:flex; justify-content:space-between; align-items:baseline; gap: 10px;">
                    <div style="font-weight: 600; font-size: 14px; display:flex; align-items:center; gap: 8px; flex-wrap: wrap;">
                        ${this._esc(x.label)} ${localityTag} ${soon}
                    </div>
                    <div style="display:flex; align-items:center; gap: 10px; flex-shrink: 0;">
                        <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--text-muted);">${this._esc(x.cost || '')}</span>
                        ${check}
                    </div>
                </div>
                ${x.description ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 3px;">${this._esc(x.description)}</div>` : ''}
                ${config}
            </div>`;
    },

    _config(x, getConfig) {
        const get = typeof getConfig === 'function' ? getConfig : () => '';
        const fields = x.configFields.map(f => `
            <label style="display:flex; flex-direction:column; gap: 3px; font-size: 11px; color: var(--text-muted);">
                ${this._esc(f.label)}
                <input type="text" value="${this._esc(get(f.key) || '')}" placeholder="${this._esc(f.placeholder || '')}"
                    onchange="VoiceAiPage.saveLocalField('${f.key}', this.value)"
                    style="padding: 7px 9px; border: 1px solid var(--border, #d1d5db); border-radius: 5px; font-size: 13px;">
            </label>`).join('');
        // stopPropagation so typing/focusing a field doesn't re-trigger row select.
        return `<div onclick="event.stopPropagation()" style="margin-top: 10px; display: grid; gap: 8px;">${fields}</div>`;
    },
};

window.VoiceAiCards = VoiceAiCards;
