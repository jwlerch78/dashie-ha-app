/* ============================================================
   Top Bar Component
   ============================================================ */

const TopBar = {
    render(pageTitle, subtitle) {
        const user = MockData.user;
        return `
            <div class="top-bar-left">
                <button class="hamburger-btn" onclick="App.toggleSidebar()">☰</button>
                <span class="top-bar-title">${pageTitle}</span>
                ${subtitle ? `<span class="top-bar-subtitle">${subtitle}</span>` : ''}
            </div>
            <div class="top-bar-right">
                <div class="top-bar-user">
                    <div class="top-bar-avatar">${user.initials}</div>
                    <span class="top-bar-username">${user.email}</span>
                </div>
            </div>
        `;
    },
};
