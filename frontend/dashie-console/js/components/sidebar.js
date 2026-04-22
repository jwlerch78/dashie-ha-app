/* ============================================================
   Sidebar Component
   ============================================================ */

const Sidebar = {
    render(activePage) {
        const credits = MockData.credits;
        return `
            <div class="sidebar-logo">
                <img src="assets/dashie-logo-orange.png" alt="Dashie" class="sidebar-logo-full">
                <img src="assets/dashie-icon.png" alt="Dashie" class="sidebar-logo-icon">
            </div>

            <div class="sidebar-section">
                <div class="sidebar-section-label">Manage</div>
                ${this._navItem('devices', 'Devices', 'icon-tv', activePage)}
                ${this._navItem('family', 'Family', 'icon-profile-round', activePage)}
                ${this._navItem('calendar', 'Calendar', 'icon-calendar', activePage)}
                ${this._navItem('chores', 'Chores', 'icon-tasks', activePage)}
                ${this._navItem('rewards', 'Rewards', 'icon-star', activePage)}
                ${this._navItem('locations', 'Locations', 'icon-location-pin', activePage)}
                ${this._navItem('photos', 'Photos', 'icon-photos', activePage)}
            </div>

            <div class="sidebar-divider"></div>

            <div class="sidebar-section">
                <div class="sidebar-section-label">Account</div>
                ${this._navItem('account', 'Account & Credits', 'icon-settings', activePage)}
            </div>

            <div class="sidebar-footer">
                <div class="sidebar-credits" onclick="App.navigate('account')">
                    <span class="sidebar-credits-amount">$${credits.total.toFixed(2)}</span>
                    <span class="sidebar-credits-label">credits</span>
                </div>
                <div class="sidebar-version">v1.0.0</div>
            </div>
        `;
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
