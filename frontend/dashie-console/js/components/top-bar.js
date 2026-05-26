/* ============================================================
   Top Bar Component
   ============================================================ */

const TopBar = {
    _menuOpen: false,

    render(pageTitle, subtitle) {
        const user = MockData.user;
        // Avatar group is clickable — opens an account menu (Account
        // Settings, Sign Out). Click outside closes via _onDocumentClick.
        return `
            <div class="top-bar-left">
                <button class="hamburger-btn" onclick="App.toggleSidebar()">☰</button>
                <span class="top-bar-title">${pageTitle}</span>
                ${subtitle ? `<span class="top-bar-subtitle">${subtitle}</span>` : ''}
            </div>
            <div class="top-bar-right">
                <div class="top-bar-user-wrapper" style="position: relative;">
                    <div class="top-bar-user" id="top-bar-user-trigger"
                         onclick="event.stopPropagation(); TopBar.toggleMenu()"
                         style="cursor: pointer; user-select: none;">
                        <div class="top-bar-avatar">${user.initials}</div>
                        <span class="top-bar-username">${user.email}</span>
                        <span class="top-bar-chevron" style="font-size: 10px; opacity: 0.6; margin-left: 2px;">▾</span>
                    </div>
                    ${this._menuOpen ? this._renderMenu() : ''}
                </div>
            </div>
        `;
    },

    _renderMenu() {
        // Show Subscribe entry when user has no current entitlement.
        // FeatureGate.hasEntitlement() is optimistic-true until SubscribeGate
        // populates state, so this only appears for confirmed-expired users.
        const showSubscribe = typeof FeatureGate !== 'undefined' && !FeatureGate.hasEntitlement();
        const subscribeRow = showSubscribe ? `
                <button onclick="TopBar.closeMenu(); AccountPage.subscribe && AccountPage.subscribe()"
                        style="width: 100%; text-align: left; padding: 10px 14px; background: none;
                               border: none; cursor: pointer; font-size: 14px; color: var(--accent, #ffaa00); font-weight: 600;">
                    Subscribe to Dashie
                </button>
                <div style="height: 1px; background: var(--border, #e5e7eb);"></div>` : '';
        return `
            <div class="top-bar-user-menu" id="top-bar-user-menu"
                 onclick="event.stopPropagation()"
                 style="position: absolute; top: calc(100% + 6px); right: 0; min-width: 220px;
                        background: var(--bg-card, #fff); border: 1px solid var(--border, #e5e7eb);
                        border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                        z-index: 1050; overflow: hidden;">
                ${subscribeRow}
                <button onclick="TopBar.closeMenu(); App.navigate('account')"
                        style="width: 100%; text-align: left; padding: 10px 14px; background: none;
                               border: none; cursor: pointer; font-size: 14px; color: var(--text-primary);">
                    Account Settings
                </button>
                <div style="height: 1px; background: var(--border, #e5e7eb);"></div>
                <button onclick="TopBar.closeMenu(); AccountPage.signOut()"
                        style="width: 100%; text-align: left; padding: 10px 14px; background: none;
                               border: none; cursor: pointer; font-size: 14px; color: var(--text-primary);">
                    Sign Out
                </button>
                <div style="height: 1px; background: var(--border, #e5e7eb);"></div>
                <button onclick="TopBar.closeMenu(); App.navigate('account'); setTimeout(() => AccountPage.handleDeleteAccount && AccountPage.handleDeleteAccount(), 100);"
                        style="width: 100%; text-align: left; padding: 10px 14px; background: none;
                               border: none; cursor: pointer; font-size: 14px; color: var(--status-error, #c00);">
                    Delete account…
                </button>
            </div>
        `;
    },

    toggleMenu() {
        this._menuOpen = !this._menuOpen;
        if (this._menuOpen) {
            // One-shot outside-click handler — re-bind on each open so we
            // don't leak listeners across re-renders.
            setTimeout(() => document.addEventListener('click', this._onDocumentClick), 0);
        } else {
            document.removeEventListener('click', this._onDocumentClick);
        }
        App.renderPage();
    },

    closeMenu() {
        if (!this._menuOpen) return;
        this._menuOpen = false;
        document.removeEventListener('click', this._onDocumentClick);
        // No render here — caller typically navigates or fires another action
        // that triggers a render of its own.
    },

    _onDocumentClick(e) {
        if (e.target.closest('#top-bar-user-menu, #top-bar-user-trigger')) return;
        TopBar._menuOpen = false;
        document.removeEventListener('click', TopBar._onDocumentClick);
        App.renderPage();
    },
};
