/* ============================================================
   Sidebar Component
   ============================================================ */

const Sidebar = {
    render(activePage) {
        // Real balance from CreditsService — fetched once at boot and
        // refreshed after every Token Usage view (and, eventually, after
        // each call that decrements it). Falls back to '—' before the
        // first fetch returns so we don't flash a wrong number.
        const cached = window.CreditsService?.balance();
        const bal = (cached && typeof cached.balance === 'number') ? cached.balance : null;
        const balanceLabel = bal !== null ? `$${bal.toFixed(2)}` : '$—';
        // Low-balance deep-link: when the balance runs low, the credits widget
        // turns into a "Buy credits" prompt (still navigates to the Account page
        // where the Buy Credits packs live). $1 matches the auto-replenish default.
        const lowBalance = bal !== null && bal < 1.00;
        // Beta visibility — see js/lib/feature-gate.js. HA-only items are
        // hidden when the console is served from the public website; the
        // credits widget is dev-only; locations is hidden everywhere until
        // the feature is ready.
        const showCredits = FeatureGate.shouldShow('credits');
        return `
            <div class="sidebar-logo">
                <img src="assets/dashie-logo-orange.png" alt="Dashie" class="sidebar-logo-full">
                <img src="assets/dashie-icon.png" alt="Dashie" class="sidebar-logo-icon">
            </div>

            <div class="sidebar-section">
                <div class="sidebar-section-label">Manage</div>
                ${this._navItem('devices', 'Dashboards', 'icon-tv', activePage)}
                ${this._gatedNavItem('voice-ai', 'Voice & AI', 'icon-ai-chat', activePage)}
                ${this._gatedNavItem('video-feeds', 'Video Feeds', 'icon-video-camera', activePage)}
                ${this._navItem('preferences', 'Preferences', 'icon-sliders', activePage)}
            </div>

            <div class="sidebar-divider"></div>

            <div class="sidebar-section">
                <div class="sidebar-section-label">Dashie Cloud</div>
                ${this._gatedNavItem('family', 'Family', 'icon-profile-round', activePage)}
                ${this._gatedNavItem('calendar', 'Calendar', 'icon-calendar', activePage)}
                ${this._gatedNavItem('chores', 'Chores', 'icon-tasks', activePage)}
                ${this._gatedNavItem('rewards', 'Rewards', 'icon-star', activePage)}
                ${this._gatedNavItem('scheduled-actions', 'Scheduled Actions', 'icon-clock', activePage)}
                ${this._gatedNavItem('locations', 'Locations', 'icon-location-pin', activePage)}
                ${this._gatedNavItem('photos', 'Photos', 'icon-photos', activePage)}
            </div>

            <div class="sidebar-divider"></div>

            <div class="sidebar-section">
                <div class="sidebar-section-label">Account</div>
                ${this._navItem('account', 'Account & Credits', 'icon-settings', activePage)}
            </div>

            <div class="sidebar-footer">
                ${showCredits ? `
                    <div class="sidebar-credits" onclick="App.navigate('account')"${lowBalance ? ' style="color: var(--status-error, #c00);" title="Low balance — buy credits"' : ''}>
                        <span class="sidebar-credits-amount">${balanceLabel}</span>
                        <span class="sidebar-credits-label">${lowBalance ? 'Buy credits →' : 'credits'}</span>
                    </div>
                ` : ''}
                <div class="sidebar-version">v1.0.0</div>
            </div>
        `;
    },

    /** Renders a nav item only when FeatureGate allows the page. */
    _gatedNavItem(page, label, iconName, activePage) {
        if (!FeatureGate.isPageEnabled(page)) return '';
        return this._navItem(page, label, iconName, activePage);
    },

    _navItem(page, label, iconName, activePage) {
        const isActive = page === activePage ? 'active' : '';
        return `
            <div class="sidebar-nav-item ${isActive}" onclick="App.navigate('${page}')">
                <span class="nav-icon"><img src="assets/icons/${iconName}.svg" alt="${label}"></span>
                <span class="nav-label">${label}</span>
            </div>
        `;
    },
};
