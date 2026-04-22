/* ============================================================
   Family Page
   ============================================================ */

const FamilyPage = {
    _members: null,
    _loading: false,
    _error: null,
    _editingId: null,       // null = list, 'new' = create form, id = edit existing
    _saving: false,
    _deleting: false,

    // Preset palette from backend auto-assignment
    PALETTE: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788'],
    RELATIONSHIPS: ['parent', 'child', 'guest'],

    render() {
        if (!this._members && !this._loading && !this._error) {
            this._fetchMembers();
            return this._renderLoading();
        }
        if (this._loading && !this._members) return this._renderLoading();
        if (this._error && !this._members) return this._renderError();

        let html = this._renderList();
        if (this._editingId) html += this._renderEditPanel();
        return html;
    },

    topBarTitle() { return 'Family'; },
    topBarSubtitle() {
        if (!this._members) return '';
        return `${this._members.length} member${this._members.length === 1 ? '' : 's'}`;
    },
    topBarActions() {
        return `<button class="btn btn-primary" onclick="FamilyPage.add()">+ Add Member</button>`;
    },

    // =========================================================

    async _fetchMembers() {
        this._loading = true;
        this._error = null;
        try {
            const result = await DashieAuth.dbRequest('list_family_members', {});
            this._members = result.members || result.data || [];
            // Sort by display_order if present, otherwise by name
            this._members.sort((a, b) => {
                const oa = a.display_order ?? 999;
                const ob = b.display_order ?? 999;
                if (oa !== ob) return oa - ob;
                return (a.full_name || '').localeCompare(b.full_name || '');
            });
        } catch (e) {
            console.error('[FamilyPage] Fetch failed:', e);
            this._error = e.message;
        } finally {
            this._loading = false;
            App.renderPage();
        }
    },

    _renderLoading() {
        return `
            <div style="display: flex; align-items: center; justify-content: center; padding: 60px;">
                <div style="text-align: center;">
                    <div style="width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 12px;"></div>
                    <div style="color: var(--text-secondary); font-size: var(--font-size-sm);">Loading family...</div>
                </div>
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
            </div>
        `;
    },

    _renderError() {
        return `
            <div class="card">
                <div class="card-body" style="color: var(--status-error);">
                    <strong>Failed to load family:</strong> ${this._escape(this._error)}
                    <div style="margin-top: 12px;">
                        <button class="btn btn-secondary btn-sm" onclick="FamilyPage._retry()">Retry</button>
                    </div>
                </div>
            </div>
        `;
    },

    _retry() {
        this._error = null;
        this._members = null;
        App.renderPage();
    },

    _renderList() {
        if (!this._members || this._members.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-state-icon">👪</div>
                    <div class="empty-state-text">No family members yet.</div>
                    <div style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: 8px;">
                        Click "+ Add Member" to get started.
                    </div>
                </div>
            `;
        }

        const items = this._members.map(m => ({
            icon: true,
            color: m.assigned_color || '#9ca3af',
            iconText: (m.full_name || '?').charAt(0).toUpperCase(),
            title: m.full_name + (m.nickname ? ` (${m.nickname})` : ''),
            subtitle: this._memberSubtitle(m),
            badge: this._capitalize(m.relationship),
            onClick: `FamilyPage.edit('${m.id}')`,
        }));

        return DataTable.list(items) + `<p class="page-summary">${this._members.length} family member${this._members.length === 1 ? '' : 's'}</p>`;
    },

    _memberSubtitle(m) {
        const parts = [];
        if (m.ha_person_entity_id) parts.push(`HA: ${m.ha_person_entity_id}`);
        if (m.gps_sharing_enabled) parts.push('GPS sharing on');
        if (m.notes) parts.push(m.notes);
        if (!parts.length) return 'No additional info';
        return parts.join(' · ');
    },

    _renderEditPanel() {
        const isNew = this._editingId === 'new';
        const member = isNew
            ? { full_name: '', nickname: '', relationship: 'child', assigned_color: this.PALETTE[0], notes: '' }
            : this._members.find(m => m.id === this._editingId);

        if (!member) return '';

        const colorDots = this.PALETTE.map(c =>
            `<div class="color-picker-dot ${c.toLowerCase() === (member.assigned_color || '').toLowerCase() ? 'selected' : ''}"
                 style="background: ${c}"
                 data-color="${c}"
                 onclick="FamilyPage._selectColor('${c}')"></div>`
        ).join('');

        return `
            <div class="edit-panel" id="family-edit-panel">
                <div class="edit-panel-header">
                    <span class="edit-panel-title">${isNew ? 'Add Family Member' : 'Edit Member'}</span>
                    <button class="edit-panel-close" onclick="FamilyPage.closeEdit()">✕</button>
                </div>

                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Name</label>
                        <input class="form-input" type="text" id="family-edit-name"
                            value="${this._escape(member.full_name || '')}"
                            placeholder="Full name">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Nickname</label>
                        <input class="form-input" type="text" id="family-edit-nickname"
                            value="${this._escape(member.nickname || '')}"
                            placeholder="Optional">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Role</label>
                        <select class="form-select" id="family-edit-role">
                            ${this.RELATIONSHIPS.map(r => `
                                <option value="${r}" ${r === member.relationship ? 'selected' : ''}>
                                    ${this._capitalize(r)}
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Color</label>
                        <div class="color-picker" id="family-color-picker">${colorDots}</div>
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">Notes</label>
                    <input class="form-input" type="text" id="family-edit-notes"
                        value="${this._escape(member.notes || '')}"
                        placeholder="Optional notes">
                </div>

                ${!isNew && member.device_linked_at ? `
                    <div class="section-header">Mobile App</div>
                    <div class="card">
                        <div class="card-body" style="padding: 12px 16px; font-size: var(--font-size-sm);">
                            <span style="color: var(--status-online);">✓</span>
                            Device linked · ${this._escape(member.device_name || 'Unknown device')}
                        </div>
                    </div>
                ` : ''}

                <div class="edit-panel-actions">
                    <button class="btn btn-primary" onclick="FamilyPage._save()" ${this._saving ? 'disabled' : ''}>
                        ${this._saving ? 'Saving…' : 'Save Changes'}
                    </button>
                    <button class="btn btn-ghost" onclick="FamilyPage.closeEdit()" ${this._saving ? 'disabled' : ''}>
                        Cancel
                    </button>
                    ${!isNew ? `
                        <button class="btn btn-danger btn-sm" onclick="FamilyPage._delete()"
                            ${this._saving || this._deleting ? 'disabled' : ''}>
                            ${this._deleting ? 'Removing…' : 'Remove Member'}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    },

    _selectColor(color) {
        const picker = document.getElementById('family-color-picker');
        if (!picker) return;
        picker.querySelectorAll('.color-picker-dot').forEach(dot => {
            dot.classList.toggle('selected', dot.dataset.color === color);
        });
    },

    _getEditValues() {
        const selectedDot = document.querySelector('#family-color-picker .color-picker-dot.selected');
        return {
            full_name: document.getElementById('family-edit-name').value.trim(),
            nickname: document.getElementById('family-edit-nickname').value.trim(),
            relationship: document.getElementById('family-edit-role').value,
            assigned_color: selectedDot ? selectedDot.dataset.color : this.PALETTE[0],
            notes: document.getElementById('family-edit-notes').value.trim(),
        };
    },

    async _save() {
        const values = this._getEditValues();

        if (!values.full_name) {
            Toast.error('Please enter a name');
            return;
        }

        this._saving = true;
        App.renderPage();

        try {
            if (this._editingId === 'new') {
                const result = await DashieAuth.dbRequest('create_family_member', values);
                const newMember = result.member || result.data;
                if (newMember) this._members.push(newMember);
            } else {
                const result = await DashieAuth.dbRequest('update_family_member', {
                    member_id: this._editingId,
                    updates: values,
                });
                const updated = result.member || result.data;
                if (updated) {
                    const idx = this._members.findIndex(m => m.id === this._editingId);
                    if (idx >= 0) this._members[idx] = updated;
                }
            }
            this._editingId = null;
        } catch (e) {
            console.error('[FamilyPage] Save failed:', e);
            Toast.error(Toast.friendly(e, 'save this member'));
        } finally {
            this._saving = false;
            App.renderPage();
        }
    },

    async _delete() {
        const member = this._members.find(m => m.id === this._editingId);
        const name = member ? member.full_name : 'this member';
        if (!confirm(`Remove ${name} from your family?`)) return;

        this._deleting = true;
        App.renderPage();

        try {
            await DashieAuth.dbRequest('delete_family_member', {
                member_id: this._editingId,
                hard_delete: false,
            });
            this._members = this._members.filter(m => m.id !== this._editingId);
            this._editingId = null;
        } catch (e) {
            console.error('[FamilyPage] Delete failed:', e);
            Toast.error(Toast.friendly(e, 'remove this member'));
        } finally {
            this._deleting = false;
            App.renderPage();
        }
    },

    edit(id) {
        this._editingId = id;
        App.renderPage();
    },

    add() {
        this._editingId = 'new';
        App.renderPage();
        // Focus the name field after render
        setTimeout(() => {
            const el = document.getElementById('family-edit-name');
            if (el) el.focus();
        }, 50);
    },

    closeEdit() {
        this._editingId = null;
        App.renderPage();
    },

    // =========================================================

    _capitalize(s) {
        if (!s) return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    },

    _escape(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
};
