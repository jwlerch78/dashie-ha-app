/* ============================================================
   Sidebar Component
   ============================================================ */

const Sidebar = {
    render(activePage) {
        const credits = MockData.credits;
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
            </div>

            <div class="sidebar-divider"></div>

            <div class="sidebar-section">
                <div class="sidebar-section-label">Dashie Cloud</div>
                ${this._gatedNavItem('family', 'Family', 'icon-profile-round', activePage)}
                ${this._gatedNavItem('calendar', 'Calendar', 'icon-calendar', activePage)}
                ${this._gatedNavItem('chores', 'Chores', 'icon-tasks', activePage)}
                ${this._gatedNavItem('rewards', 'Rewards', 'icon-star', activePage)}
                ${this._gatedNavItem('locations', 'Locations', 'icon-location-pin', activePage)}
                ${this._gatedNavItem('photos', 'Photos', 'icon-photos', activePage)}
            </div>

            <div class="sidebar-divider"></div>

            <div class="sidebar-section">
                <div class="sidebar-section-label">Account</div>
                ${this._navItem('account', 'Account & Credits', 'icon-settings', activePage)}
            </div>

            ${FeatureGate.isPageEnabled('feature-adoption') ? `
                <div class="sidebar-divider"></div>
                <div class="sidebar-section">
                    <div class="sidebar-section-label">Admin</div>
                    ${this._navItem('feature-adoption', 'Feature Adoption', 'icon-chart', activePage)}
                </div>
            ` : ''}

            <div class="sidebar-footer">
                ${showCredits ? `
                    <div class="sidebar-credits" onclick="App.navigate('account')">
                        <span class="sidebar-credits-amount">$${credits.total.toFixed(2)}</span>
                        <span class="sidebar-credits-label">credits</span>
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
