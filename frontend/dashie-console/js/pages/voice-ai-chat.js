/* ============================================================
   Voice & AI — Test Chat subpage
   ------------------------------------------------------------
   Full-page subpage (not a modal). VoiceAiPage.render() defers
   to this module's render() when _open is truthy.

   Layout:
       [← Back to Voice & AI]
       [Personality ▾]  [Model ▾]
       [textarea                                ] [Send]
       ───── history (newest first) ─────────────────────
         User: …
         AI:   <voice in 18px>
               <text in 13px, muted>
               [action: 2 commands executed ✓]
               model · provider · 642 ms · 412 in / 38 out tokens

   State is per-session — history clears when the user navigates
   away or closes the page. Last-used personality + model persist
   to ConsoleState so reopening the chat keeps your selections.
   ============================================================ */

const VoiceAiChat = {
    /** null when closed; object when open. Shape:
     *  { personalityId, modelId, draft, busy, history, lastError } */
    _open: null,

    /** localStorage / ConsoleState keys for "remember last selection". */
    _STATE_KEY: 'voiceAiChat',

    open() {
        const remembered = (typeof ConsoleState !== 'undefined' && ConsoleState._state?.[this._STATE_KEY]) || {};
        const defaults = VoiceAiPage._defaults || {};
        // Personality is per-device on the tablet, not per-account — there's
        // no account default. Fall back to "dashie" (the canonical built-in).
        const personalityId = remembered.personalityId || 'dashie';
        // Model: account default from ai.model lives on user_settings.
        const modelId = remembered.modelId
            || defaults['ai.model']
            || 'claude-sonnet-4-5-20250929';
        this._open = {
            personalityId,
            modelId,
            draft: '',
            busy: false,
            history: [],   // [{ role: 'user'|'ai', ...payload }]
            lastError: null,
        };
        App.renderPage();
    },

    close() {
        this._open = null;
        App.renderPage();
    },

    setPersonality(id) {
        if (!this._open) return;
        this._open.personalityId = id;
        this._remember();
        App.renderPage();
    },

    setModel(id) {
        if (!this._open) return;
        this._open.modelId = id;
        this._remember();
        App.renderPage();
    },

    setDraft(value) {
        if (!this._open) return;
        // Don't re-render on keystroke; just capture the value for the
        // next send. The textarea's defaultValue keeps what the user typed.
        this._open.draft = value;
    },

    _remember() {
        if (!this._open) return;
        if (typeof ConsoleState === 'undefined') return;
        ConsoleState._normalize?.();
        ConsoleState._state[this._STATE_KEY] = {
            personalityId: this._open.personalityId || null,
            modelId: this._open.modelId || null,
        };
        ConsoleState._save?.({ [this._STATE_KEY]: ConsoleState._state[this._STATE_KEY] });
    },

    onKeyDown(e) {
        // Cmd/Ctrl+Enter sends.
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            this.send();
        }
    },

    async send() {
        if (!this._open || this._open.busy) return;
        const ta = document.getElementById('voice-ai-chat-input');
        const text = (ta?.value || this._open.draft || '').trim();
        if (!text) return;

        const turnId = Date.now();
        const pendingId = turnId + 1;
        this._open.busy = true;
        this._open.lastError = null;
        this._open.history.unshift({ id: turnId, role: 'user', text });
        this._open.history.unshift({ id: pendingId, role: 'pending', stage: 'Calling AI…', stages: [] });
        this._open.draft = '';
        if (ta) ta.value = '';
        App.renderPage();
        setTimeout(() => document.getElementById('voice-ai-chat-input')?.focus(), 0);

        const onStage = (name, detail) => {
            if (!this._open) return;
            const pending = this._open.history.find(h => h.id === pendingId);
            if (!pending) return;
            const labels = {
                pass1_start: 'Calling AI…',
                pass1_done: detail?.type === 'info_request'
                    ? 'AI requested HA entities…'
                    : 'AI replied — wrapping up…',
                fetch_entities_start: 'Fetching HA entities…',
                fetch_entities_done: `Got ${detail?.entity_count || 0} entities. Calling AI again…`,
                pass2_start: 'Calling AI again with entity context…',
                pass2_done: 'AI replied — dispatching…',
            };
            pending.stage = labels[name] || name;
            pending.stages.push({ name, t: Date.now(), detail });
            App.renderPage();
        };

        let result;
        try {
            const prior = this._open.history
                .filter(h => h.role === 'user' || h.role === 'ai')
                .slice()
                .reverse()
                .map(h => h.role === 'user'
                    ? { role: 'user', content: h.text }
                    : { role: 'ai', content: h.voice || h.text || '' });
            result = await ConsoleAiClient.sendQuery(text, {
                personalityId: this._open.personalityId,
                modelId: this._open.modelId,
                history: prior,
                onStage,
            });
        } catch (e) {
            result = { ok: false, error: e?.message || String(e) };
        }

        if (!this._open) return;
        this._open.history = this._open.history.filter(h => h.id !== pendingId);
        if (result?.ok) {
            this._open.history.unshift({ id: pendingId, role: 'ai', ...result });
        } else {
            this._open.history.unshift({ id: pendingId, role: 'ai-error', error: result?.error || 'Unknown error', latency_ms: result?.latency_ms, stages: result?.stages });
            this._open.lastError = result?.error || null;
        }
        this._open.busy = false;
        App.renderPage();
    },

    clearHistory() {
        if (!this._open) return;
        if (!confirm('Clear the chat history?')) return;
        this._open.history = [];
        App.renderPage();
    },

    // ── Render ───────────────────────────────────────────────

    render() {
        const m = this._open;
        if (!m) return '';
        const esc = VoiceAiPage._escape.bind(VoiceAiPage);
        const selectStyle = `padding: 6px 10px; border: 1px solid var(--border, #d1d5db); border-radius: 4px; background: var(--bg-card, #fff); font-size: 13px;`;

        // Personalities: use the same source the parent page renders.
        // Custom rows (UUID) come first, then built-in templates by key.
        const customPersonalities = VoiceAiPage._custom || [];
        const templatePersonalities = VoiceAiPage._templates || [];
        const personalityHtml = (() => {
            const opt = (val, label) => `<option value="${esc(val)}" ${m.personalityId === val ? 'selected' : ''}>${esc(label)}</option>`;
            const groups = [];
            if (customPersonalities.length) {
                groups.push(`<optgroup label="Custom">${customPersonalities.map(p => opt(p.id, p.name)).join('')}</optgroup>`);
            }
            if (templatePersonalities.length) {
                groups.push(`<optgroup label="Built-in">${templatePersonalities.map(t => opt(t.key || t.id, t.name)).join('')}</optgroup>`);
            }
            if (!groups.length) groups.push(opt('dashie', 'Dashie (default)'));
            return `<select id="voice-ai-chat-personality" onchange="VoiceAiChat.setPersonality(this.value)" style="${selectStyle}">${groups.join('')}</select>`;
        })();

        // Models: the same provider-grouped catalog the AI Defaults section
        // uses. Falls back to a single safe default if VoiceAiPage hasn't
        // initialised yet.
        const modelGroups = VoiceAiPage.MODEL_GROUPS || [['Claude', [['claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5']]]];
        const modelHtml = (() => {
            const opt = (val, label) => `<option value="${esc(val)}" ${m.modelId === val ? 'selected' : ''}>${esc(label)}</option>`;
            const groups = modelGroups.map(([groupLabel, items]) =>
                `<optgroup label="${esc(groupLabel)}">${items.map(([v, l]) => opt(v, l)).join('')}</optgroup>`);
            return `<select id="voice-ai-chat-model" onchange="VoiceAiChat.setModel(this.value)" style="${selectStyle}">${groups.join('')}</select>`;
        })();

        const sendBusy = m.busy;
        const sendLabel = sendBusy ? 'Thinking…' : 'Send (⌘⏎)';

        return `
            <style>
                @keyframes voiceAiChatPulse {
                    0%, 100% { opacity: 0.3; transform: scale(0.8); }
                    50%      { opacity: 1;   transform: scale(1.2); }
                }
            </style>
            <div style="max-width: 760px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
                    <button class="btn btn-ghost btn-sm" onclick="VoiceAiChat.close()">← Back to Voice & AI</button>
                    <h2 style="margin: 0; font-size: 18px; flex: 1;">AI Chat Interface</h2>
                    ${m.history.length ? `<button class="btn btn-ghost btn-sm" onclick="VoiceAiChat.clearHistory()">Clear history</button>` : ''}
                </div>

                <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 12px;">
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-muted);">
                        Personality
                        ${personalityHtml}
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-muted);">
                        Model
                        ${modelHtml}
                    </label>
                </div>

                <div style="display: flex; gap: 8px; align-items: flex-end; margin-bottom: 24px;">
                    <textarea id="voice-ai-chat-input"
                        placeholder="Ask anything. Try: turn off the kitchen lights, what's on the calendar tomorrow, set the office to 72°"
                        oninput="VoiceAiChat.setDraft(this.value)"
                        onkeydown="VoiceAiChat.onKeyDown(event)"
                        ${sendBusy ? 'disabled' : ''}
                        rows="3"
                        style="flex: 1; padding: 10px 12px; border: 1px solid var(--border, #d1d5db); border-radius: 6px; font-family: inherit; font-size: 14px; resize: vertical; min-height: 60px;">${esc(m.draft || '')}</textarea>
                    <button class="btn btn-primary"
                        onclick="VoiceAiChat.send()"
                        ${sendBusy ? 'disabled' : ''}
                        style="padding: 10px 18px; min-width: 110px;">
                        ${sendLabel}
                    </button>
                </div>

                ${m.lastError ? `
                    <div style="margin-bottom: 16px; padding: 8px 12px; border-left: 3px solid var(--status-error, #c00); background: #fff5f5; color: #831818; font-size: 13px;">
                        ${esc(m.lastError)}
                    </div>` : ''}

                <div>
                    ${m.history.length === 0
                        ? `<p style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 40px 0;">
                               No turns yet. Type a query above to start. ⌘⏎ to send.
                           </p>`
                        : m.history.map(h => this._renderTurn(h)).join('')}
                </div>
            </div>
        `;
    },

    _renderTurn(h) {
        const esc = VoiceAiPage._escape.bind(VoiceAiPage);

        if (h.role === 'user') {
            // White pill on dark bg — mirrors the tablet's voice-overlay__user-message.
            return `
                <div style="margin-bottom: 18px; padding: 12px 18px; background: rgba(255, 255, 255, 0.92); color: #000; border-radius: 8px; font-size: 18px; line-height: 1.4;">
                    ${esc(h.text)}
                </div>`;
        }

        if (h.role === 'pending') {
            // Animated dots + stage label — voice-overlay__thinking pattern.
            return `
                <div style="margin-bottom: 18px; padding: 14px 18px; background: #0f0f10; border-radius: 8px; display: flex; align-items: center; gap: 14px; min-height: 48px;">
                    <span style="display: inline-flex; gap: 6px;">
                        <span class="voice-ai-chat-dot" style="width: 9px; height: 9px; border-radius: 50%; background: #ff6b1a; animation: voiceAiChatPulse 1.4s ease-in-out infinite;"></span>
                        <span class="voice-ai-chat-dot" style="width: 9px; height: 9px; border-radius: 50%; background: #ff6b1a; animation: voiceAiChatPulse 1.4s ease-in-out 0.2s infinite;"></span>
                        <span class="voice-ai-chat-dot" style="width: 9px; height: 9px; border-radius: 50%; background: #ff6b1a; animation: voiceAiChatPulse 1.4s ease-in-out 0.4s infinite;"></span>
                    </span>
                    <span style="font-size: 14px; color: rgba(220, 220, 220, 0.9);">${esc(h.stage || 'Thinking…')}</span>
                </div>`;
        }

        if (h.role === 'ai-error') {
            return `
                <div style="margin-bottom: 18px; padding: 14px 18px; background: #1a0a0a; border-left: 3px solid #f87171; border-radius: 0 8px 8px 0;">
                    <div style="font-size: 11px; font-weight: 600; color: #f87171; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Error</div>
                    <div style="font-size: 14px; color: #fca5a5;">${esc(h.error || 'Unknown error')}</div>
                    ${h.latency_ms ? `<div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${h.latency_ms} ms before failure</div>` : ''}
                </div>`;
        }

        // ai turn
        const usage = h.usage || {};
        const meta = [];
        if (h.model)    meta.push(esc(h.model));
        if (h.provider && h.provider !== h.model) meta.push(esc(h.provider));
        if (h.latency_ms != null) meta.push(`${h.latency_ms} ms gateway`);
        if (usage.input_tokens || usage.output_tokens) {
            meta.push(`${usage.input_tokens || 0} in / ${usage.output_tokens || 0} out`);
        }
        if (h.total_latency_ms != null && h.total_latency_ms !== h.latency_ms) {
            meta.push(`${h.total_latency_ms} ms total`);
        }

        // Per-stage breakdown shown as a second meta line when there's
        // more than just pass1 (i.e. we did the two-pass HA flow).
        const stageBits = [];
        for (const s of (h.stages || [])) {
            if (s.name === 'pass1') stageBits.push(`pass1 ${s.latency_ms}ms`);
            else if (s.name === 'fetch_entities') stageBits.push(`entities ${s.latency_ms}ms (${s.entity_count})`);
            else if (s.name === 'pass2') stageBits.push(`pass2 ${s.latency_ms}ms`);
        }
        const stagesLine = stageBits.length > 1
            ? `<div style="margin-top: 4px; font-size: 11px; color: rgba(255, 255, 255, 0.4); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${stageBits.join('  ·  ')}</div>`
            : '';

        const parsedWarning = h.parsed_ok === false
            ? `<div style="font-size: 12px; color: #fbbf24; margin-top: 8px;">⚠ Model didn't return valid JSON — showing raw output</div>`
            : '';

        const action = h.action ? this._renderAction(h) : '';

        return `
            <div style="margin-bottom: 24px; padding: 18px 22px; background: #0f0f10; border-radius: 10px; color: #fff;">
                <div style="font-size: 28px; line-height: 1.3; font-weight: 700; color: #fff; white-space: pre-wrap; margin-bottom: ${h.text ? '14px' : '0'};">${esc(h.voice || '')}</div>
                ${h.text ? `<div style="font-size: 18px; line-height: 1.5; color: rgba(255, 255, 255, 0.78); white-space: pre-wrap;">${esc(h.text)}</div>` : ''}
                ${action}
                ${parsedWarning}
                <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.1); font-size: 11px; color: rgba(255, 255, 255, 0.5); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
                    ${meta.join('  ·  ')}
                </div>
                ${stagesLine}
            </div>
        `;
    },

    _renderAction(h) {
        const esc = VoiceAiPage._escape.bind(VoiceAiPage);
        const a = h.action;
        const r = h.action_result;
        const lines = [];
        lines.push(`<div style="font-size: 11px; font-weight: 600; color: rgba(255, 255, 255, 0.5); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 16px;">Action</div>`);

        if (a.command === 'execute_commands') {
            const cmds = Array.isArray(a.parameters?.commands) ? a.parameters.commands : [];
            const rows = cmds.map((c, i) => {
                const result = r?.results?.[i];
                const status = !r || !r.dispatched ? '·'
                    : result?.ok ? '✓'
                    : '✗';
                const color = result?.ok ? '#34d399' : (result === undefined ? 'rgba(255,255,255,0.5)' : '#f87171');
                const errLine = result?.error
                    ? `<div style="font-size: 11px; color: #f87171; margin-left: 18px;">${esc(result.error)}</div>` : '';
                return `
                    <div style="font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 6px; color: rgba(255, 255, 255, 0.85);">
                        <span style="color: ${color}; font-weight: 700; display: inline-block; width: 14px;">${status}</span>
                        ${esc(`${c.domain || ''}.${c.service || ''}`)}
                        ${c.data?.entity_id ? `<span style="color: rgba(255, 255, 255, 0.45);"> → ${esc(c.data.entity_id)}</span>` : ''}
                        ${errLine}
                    </div>`;
            }).join('');
            lines.push(`<div style="margin-top: 4px;">${rows}</div>`);
        } else if (a.command === 'forward_to_assist') {
            const speech = r?.response?.response?.speech?.plain?.speech || '';
            lines.push(`<div style="font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 6px; color: rgba(255, 255, 255, 0.7);">→ HA Assist: ${esc(a.parameters?.transcript || '')}</div>`);
            if (speech) lines.push(`<div style="font-size: 12px; margin-top: 4px; color: rgba(255, 255, 255, 0.7);">↩ ${esc(speech)}</div>`);
            if (r?.error) lines.push(`<div style="font-size: 11px; color: #f87171; margin-top: 4px;">${esc(r.error)}</div>`);
        } else {
            lines.push(`<pre style="font-size: 11px; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.85); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 6px 0 0;">${esc(JSON.stringify(a, null, 2))}</pre>`);
            if (r?.reason) lines.push(`<div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 4px;">${esc(r.reason)}</div>`);
        }

        return lines.join('');
    },
};

window.VoiceAiChat = VoiceAiChat;
