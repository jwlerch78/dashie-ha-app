/* ============================================================
   Voice & AI component cards
   ------------------------------------------------------------
   Renders one "component card" for a pipeline stage (AI Model /
   Speech-to-text / Text-to-speech / Web search source).

   Collapsed: shows only the selected option, with a ▾ — click the
   box to open. Expanded: shows every option (grouped by provider
   when options carry a `group`); click an option to select it,
   which collapses the card again.

   Each row: a colored Cloud/Local tag + a light row tint (orange =
   cloud, green = local, no icons), the option name, cost +
   description, and — when selected with configFields — inline
   inputs (Local-LLM endpoint, SearXNG URL, …).

   Pure render. State lives in VoiceAiPage; interactions call back:
     VoiceAiPage.toggleCard(stageKey)              (collapsed → open)
     VoiceAiPage.selectOption(stageKey, id)        (open → pick + close)
     VoiceAiPage.saveLocalField(dottedKey, value)
   ============================================================ */

const VoiceAiCards = {
    _esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    /** @param {object} o { title, stageKey, options[], selectedId, expanded, getConfig(key) } */
    render(o) {
        const opts = o.options || [];
        const sel = opts.find(x => x.id === o.selectedId) || opts[0];
        if (!sel) return '';

        // Single-option tool (e.g. Sports = ESPN only): a static info row, no expand.
        if (opts.length === 1) {
            return `
                <div style="margin-bottom: 16px;">
                    <div style="margin-bottom: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">${this._esc(o.title)}</div>
                    <div class="card"><div class="card-body" style="padding: 0;">
                        ${this._row(sel, true, o.stageKey, o.getConfig, true, 'static')}
                    </div></div>
                </div>`;
        }

        let body;
        if (o.expanded) {
            // Explicit "you're choosing" header with a ▴ close affordance, so an
            // open card is unmistakable (vs the subtle ▾ in the collapsed state).
            const head = `
                <div onclick="VoiceAiPage.toggleCard('${o.stageKey}')"
                    style="cursor: pointer; display:flex; justify-content:space-between; align-items:center; padding: 10px 14px; border-bottom: 1px solid var(--border, #e5e7eb); background: var(--surface-muted, #fafafa);">
                    <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent);">Choose ${this._esc(o.title)}</span>
                    <span style="color: var(--text-muted); font-size: 13px;">▴</span>
                </div>`;
            let prevGroup = null;
            const rows = opts.map((x, i) => {
                const groupChanged = !!x.group && x.group !== prevGroup;
                let header = '';
                if (groupChanged) {
                    header = `<div style="padding: 9px 14px 5px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); ${i === 0 ? '' : 'border-top: 1px solid var(--border, #e5e7eb);'}">${this._esc(x.group)}</div>`;
                    prevGroup = x.group;
                }
                const firstInGroup = groupChanged || i === 0;
                return header + this._row(x, x.id === o.selectedId, o.stageKey, o.getConfig, firstInGroup, 'select');
            }).join('');
            body = head + rows;
        } else {
            body = this._row(sel, true, o.stageKey, o.getConfig, true, 'expand');
        }

        // Open card pops with an accent ring + shadow; sibling cards dim while
        // another is open so it's clear which selector is currently active.
        const cardStyle = o.expanded
            ? 'box-shadow: 0 0 0 2px var(--accent), 0 6px 18px rgba(0,0,0,0.10); border-color: var(--accent);'
            : '';
        const dimmed = !o.expanded && o.anyExpanded;
        return `
            <div style="margin-bottom: 16px; transition: opacity 120ms ease; ${dimmed ? 'opacity: 0.45;' : ''}">
                <div style="margin-bottom: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">${this._esc(o.title)}</div>
                <div class="card" style="${cardStyle}"><div class="card-body" style="padding: 0;">
                    ${body}
                </div></div>
            </div>`;
    },

    _row(x, selected, stageKey, getConfig, isFirst, mode) {
        const O = window.VoiceAiOptions;
        const color = O.COLOR[x.locality] || 'var(--text-muted)';
        const bg = (O.BG || {})[x.locality] || 'transparent';
        const localityTag = `<span style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:${color};">${O.LABEL[x.locality] || ''}</span>`;
        const soon = x.comingSoon
            ? `<span style="font-size:10px; font-weight:600; color: var(--text-muted); background: var(--bg-card, #fff); border: 1px solid var(--border, #e5e7eb); padding: 1px 6px; border-radius: 9px;">coming soon</span>`
            : '';
        const isStatic = mode === 'static';
        // Install row: an uninstalled HA engine advertised with an "Install ↗" badge
        // that deep-links to the add-on store (the row is not selectable).
        const isInstall = !!x.install;
        const installBadge = isInstall
            ? `<span style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:#fff; background: var(--accent); padding: 2px 8px; border-radius: 9px;">Install ↗</span>`
            : '';
        // Collapsed (expand mode) always shows ▾ to click-to-open, even for a stale
        // install selection; the Install badge only shows in the expanded option list.
        const right = mode === 'expand'
            ? `<span style="color: var(--text-muted); font-size: 13px;">▾</span>`
            : (isInstall ? installBadge
                : (!isStatic && selected ? `<span style="color: var(--accent); font-weight: 700;">✓</span>` : ''));
        const config = (!isInstall && selected && x.configFields) ? this._config(x, getConfig) : '';
        // One-line note under a selected local engine (e.g. "local voices don't
        // change per personality"). Build plan §6.
        const note = (!isInstall && selected && x.note)
            ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 8px; line-height: 1.4;">${this._esc(x.note)}</div>`
            : '';
        const topBorder = isFirst ? '' : 'border-top: 1px solid var(--border, #e5e7eb);';
        const onclick = (isInstall && mode !== 'expand')
            ? `window.open('${x.install.url}', '_blank', 'noopener')`   // expanded list: deep-link to add-on store
            : (isStatic ? ''
                : (mode === 'expand'
                    ? `VoiceAiPage.toggleCard('${stageKey}')`           // collapsed: click to open the picker
                    : `VoiceAiPage.selectOption('${stageKey}', '${this._esc(x.id)}')`));
        const onclickAttr = onclick ? `onclick="${onclick}"` : '';

        return `
            <div ${onclickAttr}
                style="cursor: ${(isStatic && !isInstall) ? 'default' : 'pointer'}; padding: 12px 14px; ${topBorder} background: ${bg}; border-left: 3px solid ${(!isInstall && selected) ? color : 'transparent'};">
                <div style="display:flex; justify-content:space-between; align-items:baseline; gap: 10px;">
                    <div style="font-weight: 600; font-size: 14px; display:flex; align-items:center; gap: 8px; flex-wrap: wrap;">
                        ${this._esc(x.label)} ${localityTag} ${soon}
                    </div>
                    <div style="display:flex; align-items:center; gap: 10px; flex-shrink: 0;">
                        <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--text-muted);">${this._esc(x.cost || '')}</span>
                        ${right}
                    </div>
                </div>
                ${x.description ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 3px;">${this._esc(x.description)}</div>` : ''}
                ${config}
                ${note}
            </div>`;
    },

    _config(x, getConfig) {
        const get = typeof getConfig === 'function' ? getConfig : () => '';
        const fields = x.configFields.map(f => `
            <label style="display:flex; flex-direction:column; gap: 3px; font-size: 11px; color: var(--text-muted);">
                ${this._esc(f.label)}
                ${this._field(f, get)}
            </label>`).join('');
        // stopPropagation so editing a field doesn't trigger the row's select/collapse.
        return `<div onclick="event.stopPropagation()" style="margin-top: 10px; display: grid; gap: 8px;">${fields}</div>`;
    },

    /** A single config-field control. `type:'select'` (detection-populated voice
     *  dropdowns) renders a <select>; everything else is a free-text input. The
     *  current value is pre-selected; if it isn't among the options (stale/hand-
     *  entered), a leading "— pick —" keeps the field honest. */
    _field(f, get) {
        const cur = get(f.key) || '';
        const inputStyle = 'padding: 7px 9px; border: 1px solid var(--border, #d1d5db); border-radius: 5px; font-size: 13px;';
        if (f.type === 'select' && Array.isArray(f.options)) {
            const known = f.options.some(o => (o.value ?? o) === cur);
            const opts = [
                `<option value="" ${cur ? '' : 'selected'} disabled>— pick a voice —</option>`,
                ...f.options.map(o => {
                    const v = o.value ?? o, l = o.label ?? o;
                    return `<option value="${this._esc(v)}" ${v === cur ? 'selected' : ''}>${this._esc(l)}</option>`;
                }),
                (cur && !known) ? `<option value="${this._esc(cur)}" selected>${this._esc(cur)} (current)</option>` : '',
            ].join('');
            return `<select onchange="VoiceAiPage.saveLocalField('${f.key}', this.value)" style="${inputStyle}">${opts}</select>`;
        }
        // Credentials (API keys) render masked; everything else is plain text.
        const inputType = f.type === 'password' ? 'password' : 'text';
        return `<input type="${inputType}" value="${this._esc(cur)}" placeholder="${this._esc(f.placeholder || '')}"
                    autocomplete="off" onchange="VoiceAiPage.saveLocalField('${f.key}', this.value)" style="${inputStyle}">`;
    },
};

window.VoiceAiCards = VoiceAiCards;
