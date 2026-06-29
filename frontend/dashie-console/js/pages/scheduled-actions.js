/* ============================================================
   Scheduled Actions Page

   Lists the household's reminders (mirrored from the device's
   AlarmManager into Supabase) and lets you edit the text / fire
   time / vernacular or delete them. Each row is collapsible with
   an inline edit form (mirrors the Family page).

   Reminders are CREATED by voice on a device ("Hey Dashie, remind
   me…"); this page only manages existing ones. After an edit/delete
   we broadcast `reminder-changed` so the owning device re-arms or
   cancels its alarm (see js/core/reminders/reminder-sync.js).
   ============================================================ */

const ScheduledActionsPage = {
    _actions: null,
    _expandedIds: null,
    _savingId: null,
    _deletingId: null,
    _loading: false,
    _error: null,
    _realtimeChannel: null,

    VERNACULARS: ['reminder', 'alarm'],

    render() {
        if (!this._actions && !this._loading && !this._error) {
            this._fetch();
            return this._renderLoading();
        }
        if (this._loading && !this._actions) return this._renderLoading();
        if (this._error && !this._actions) return this._renderError();
        if (!this._expandedIds) this._expandedIds = new Set();
        return this._renderList();
    },

    topBarTitle() { return 'Scheduled Actions'; },
    topBarSubtitle() {
        if (!this._actions) return '';
        const n = this._actions.filter(a => a.status === 'scheduled').length;
        return `${n} active reminder${n === 1 ? '' : 's'}`;
    },
    topBarActions() { return ''; },

    // Refetch + (re)subscribe each time the page is opened.
    onNavigateTo() {
        this._fetch();
        this._ensureRealtimeSub();
    },

    // Title-bar refresh icon — app.js renders it left of the title for any page
    // that exposes a refresh() hook.
    refresh() {
        return this._fetch();
    },

    // =========================================================

    async _fetch() {
        this._loading = true;
        this._error = null;
        try {
            const result = await DashieAuth.dbRequest('list_scheduled_actions', {});
            this._actions = (result.actions || result.data || []).slice();
        } catch (e) {
            console.error('[ScheduledActionsPage] Fetch failed:', e);
            this._error = e.message;
        } finally {
            this._loading = false;
            App.renderPage();
        }
    },

    async _ensureRealtimeSub() {
        if (this._realtimeChannel) return;
        try {
            this._realtimeChannel = await DashieAuth.subscribeToChannel(
                'scheduled-actions', 'reminder-changed',
                () => this._fetch()  // a device (or another console) changed something → refresh
            );
        } catch (e) {
            console.warn('[ScheduledActionsPage] realtime subscribe failed', e);
        }
    },

    _renderLoading() {
        return `
            <div style="display: flex; align-items: center; justify-content: center; padding: 60px;">
                <div style="text-align: center;">
                    <div style="width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 12px;"></div>
                    <div style="color: var(--text-secondary); font-size: var(--font-size-sm);">Loading reminders...</div>
                </div>
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
            </div>
        `;
    },

    _renderError() {
        return `
            <div class="card">
                <div class="card-body" style="color: var(--status-error);">
                    <strong>Failed to load scheduled actions:</strong> ${this._escape(this._error)}
                    <div style="margin-top: 12px;">
                        <button class="btn btn-secondary btn-sm" onclick="ScheduledActionsPage._retry()">Retry</button>
                    </div>
                </div>
            </div>
        `;
    },

    _retry() {
        this._error = null;
        this._actions = null;
        this._expandedIds = null;
        App.renderPage();
    },

    _renderList() {
        const actions = this._actions || [];
        if (actions.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-state-icon">⏰</div>
                    <div class="empty-state-text">No scheduled actions.</div>
                    <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: 8px;">
                        Say "Hey Dashie, remind me…" on a device to create one.
                    </div>
                </div>
            `;
        }
        const scheduled = actions.filter(a => a.status === 'scheduled');
        const history = actions.filter(a => a.status !== 'scheduled');
        let html = scheduled.map(a => this._renderRow(a)).join('');
        if (history.length) {
            html += `<div class="list-item-subtitle" style="margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.04em;">History</div>`;
            html += history.map(a => this._renderRow(a)).join('');
        }
        return html;
    },

    _renderRow(action) {
        const id = this._escape(action.id);
        const editable = action.status === 'scheduled';
        const expanded = editable && this._expandedIds.has(action.id);
        const chevron = editable ? (expanded ? '▾' : '▸') : '·';
        const label = action.notify_text
            ? this._escape(action.notify_text)
            : `<span style="color: var(--text-muted); font-style: italic;">(no text)</span>`;
        const when = this._fmtWhen(action.fire_at);
        const statusBadge = action.status === 'scheduled'
            ? ''
            : `<span class="list-item-badge" style="background: var(--bg-muted, #f3f4f6); color: var(--text-secondary);">${this._capitalize(action.status)}</span>`;

        const header = `
            <div class="account-header"
                 ${editable ? `onclick="ScheduledActionsPage.toggleExpand('${id}')"` : ''}
                 style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; ${editable ? 'cursor: pointer;' : ''} background: var(--bg-card, #fff);">
                <span style="font-size: 24px; line-height: 1; color: var(--text-muted); width: 20px; text-align: center; flex-shrink: 0;">${chevron}</span>
                <div style="flex: 1; min-width: 0;">
                    <div class="list-item-title">${label}</div>
                    <div class="list-item-subtitle">${this._capitalize(action.vernacular || 'reminder')} · ${when}</div>
                </div>
                ${statusBadge}
            </div>`;

        const body = expanded
            ? `<div style="border-top: 1px solid var(--border, #e5e7eb); padding: 16px 20px;">${this._renderEditForm(action)}</div>`
            : '';

        return `
            <div class="account-group" style="border: 1px solid var(--border, #e5e7eb); border-radius: 8px; margin-bottom: 12px; overflow: hidden; ${editable ? '' : 'opacity: 0.7;'}">
                ${header}
                ${body}
            </div>
        `;
    },

    _renderEditForm(action) {
        const id = this._escape(action.id);
        const saving = this._savingId === action.id;
        const deleting = this._deletingId === action.id;
        return `
            <div class="form-grid">
                <div class="form-group">
                    <label class="form-label">Reminder text</label>
                    <input class="form-input" type="text" id="sa-${id}-text"
                        value="${this._escape(action.notify_text || '')}"
                        placeholder="What to remind you">
                </div>
                <div class="form-group">
                    <label class="form-label">Fires at</label>
                    <input class="form-input" type="datetime-local" id="sa-${id}-time"
                        value="${this._toLocalInput(action.fire_at)}">
                </div>
                <div class="form-group">
                    <label class="form-label">Type</label>
                    <select class="form-select" id="sa-${id}-vern">
                        ${this.VERNACULARS.map(v => `
                            <option value="${v}" ${v === (action.vernacular || 'reminder') ? 'selected' : ''}>
                                ${this._capitalize(v)}
                            </option>
                        `).join('')}
                    </select>
                </div>
            </div>

            <div class="edit-panel-actions" style="margin-top: 16px;">
                <button class="btn btn-primary" onclick="ScheduledActionsPage._save('${id}')" ${saving ? 'disabled' : ''}>
                    ${saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button class="btn btn-ghost" onclick="ScheduledActionsPage.toggleExpand('${id}')" ${saving ? 'disabled' : ''}>
                    Cancel
                </button>
                <button class="btn btn-danger btn-sm" onclick="ScheduledActionsPage._delete('${id}')" ${saving || deleting ? 'disabled' : ''}>
                    ${deleting ? 'Deleting…' : 'Delete'}
                </button>
            </div>
        `;
    },

    async _save(id) {
        const text = document.getElementById(`sa-${id}-text`).value.trim();
        const localDt = document.getElementById(`sa-${id}-time`).value;
        const vernacular = document.getElementById(`sa-${id}-vern`).value;
        const fireAt = this._fromLocalInput(localDt);
        if (!fireAt) { Toast.error('Please pick a valid date and time'); return; }

        this._savingId = id;
        App.renderPage();
        try {
            const result = await DashieAuth.dbRequest('update_scheduled_action', {
                id, notify_text: text, fire_at: fireAt, vernacular,
            });
            const updated = result.action || result.data;
            if (!updated) {
                Toast.error('That reminder can no longer be edited (it already fired or was cancelled).');
                await this._fetch();
                return;
            }
            const idx = this._actions.findIndex(a => a.id === id);
            if (idx >= 0) this._actions[idx] = updated;
            this._expandedIds.delete(id);
            // Tell the owning device to re-arm at the new time.
            DashieAuth.broadcast('scheduled-actions', 'reminder-changed', { action: 'updated', row: updated })
                .catch(e => console.warn('[ScheduledActionsPage] broadcast failed', e));
        } catch (e) {
            console.error('[ScheduledActionsPage] Save failed:', e);
            Toast.error(Toast.friendly(e, 'update this reminder'));
        } finally {
            this._savingId = null;
            App.renderPage();
        }
    },

    async _delete(id) {
        const action = (this._actions || []).find(a => a.id === id);
        const label = action && action.notify_text ? `"${action.notify_text}"` : 'this reminder';
        const ok = await ConfirmModal.confirm({
            title: 'Delete reminder',
            message: `Delete ${label}?\n\nIt will be cancelled on the device.`,
            confirmLabel: 'Delete',
            danger: true,
        });
        if (!ok) return;

        this._deletingId = id;
        App.renderPage();
        try {
            const result = await DashieAuth.dbRequest('cancel_scheduled_action', { id });
            const cancelled = result.action || result.data;
            this._actions = this._actions.filter(a => a.id !== id);
            this._expandedIds.delete(id);
            // Tell the owning device to cancel its alarm (carry the row so it can match).
            DashieAuth.broadcast('scheduled-actions', 'reminder-changed', {
                action: 'cancelled',
                row: cancelled || (action ? { ...action, status: 'cancelled' } : null),
            }).catch(e => console.warn('[ScheduledActionsPage] broadcast failed', e));
        } catch (e) {
            console.error('[ScheduledActionsPage] Delete failed:', e);
            Toast.error(Toast.friendly(e, 'delete this reminder'));
        } finally {
            this._deletingId = null;
            App.renderPage();
        }
    },

    toggleExpand(id) {
        if (!this._expandedIds) this._expandedIds = new Set();
        if (this._expandedIds.has(id)) this._expandedIds.delete(id);
        else this._expandedIds.add(id);
        App.renderPage();
    },

    // =========================================================

    _fmtWhen(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return this._escape(iso);
        return d.toLocaleString([], {
            weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        });
    },

    // ISO (UTC) → 'YYYY-MM-DDTHH:mm' in local time for <input type="datetime-local">
    _toLocalInput(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    // local 'YYYY-MM-DDTHH:mm' → ISO (UTC); null if invalid
    _fromLocalInput(val) {
        if (!val) return null;
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d.toISOString();
    },

    _capitalize(s) {
        if (!s) return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    },

    _escape(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
};
