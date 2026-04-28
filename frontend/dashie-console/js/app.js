/* ============================================================
   Dashie Console — App Router
   ============================================================ */

const App = {
    _currentPage: 'devices',
    _sidebarOpen: false,

    pages: {
        devices:       { page: DevicesPage },
        'voice-ai':    { page: VoiceAiPage },
        'video-feeds': { page: VideoFeedsPage },
        family:        { page: FamilyPage },
        calendar:      { page: CalendarPage },
        chores:        { page: ChoresPage },
        rewards:       { page: RewardsPage },
        locations:     { page: LocationsPage },
        photos:        { page: PhotosPage },
        account:       { page: AccountPage },
    },

    async init() {
        // Wire up auth state change callback
        DashieAuth.onAuthStateChange = (isAuth) => {
            if (isAuth) {
                this._showApp();
            } else {
                this._showLogin();
            }
        };

        // Initialize auth (checks localStorage for JWT, handles OAuth callback)
        try {
            const result = await DashieAuth.init();

            // If init returned a promise (OAuth callback), it handled the redirect
            if (result === true) {
                // OAuth callback was handled — JWT is now set
                this._showApp();
                return;
            }
        } catch (e) {
            console.error('[App] Auth init error:', e);
        }

        if (DashieAuth.isAuthenticated) {
            this._showApp();
        } else {
            this._showLogin();
        }
    },

    _showLogin() {
        document.getElementById('sidebar').innerHTML = '';
        document.getElementById('top-bar').innerHTML = '';
        const addonMode = DashieAuth.isAddonMode;
        const onClick = addonMode ? 'App._handleAddonSignIn()' : 'DashieAuth.signIn()';
        const title = addonMode ? 'Sign in to Dashie' : 'Welcome to Dashie Console';
        const subtitle = addonMode
            ? 'Connect your Home Assistant to your Dashie account.'
            : 'Manage your devices, household, and account from any browser.';

        document.getElementById('content').innerHTML = `
            <div class="dashie-login-overlay">
                <div class="dashie-login-card" id="login-card">
                    <img src="assets/dashie-logo-orange.png" alt="Dashie" class="dashie-login-logo">
                    <div class="dashie-login-title">${title}</div>
                    <div class="dashie-login-subtitle">${subtitle}</div>

                    <div class="dashie-login-buttons">
                        <button class="dashie-path-btn primary" onclick="${onClick}">
                            <span class="dashie-path-icon">
                                <svg width="36" height="36" viewBox="0 0 48 48">
                                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                                </svg>
                            </span>
                            <span class="dashie-path-text">
                                <span class="dashie-path-label">Sign in with Google</span>
                                <span class="dashie-path-desc">Use your Dashie account</span>
                            </span>
                        </button>

                        <div class="dashie-path-divider"><span>or</span></div>

                        <button class="dashie-path-btn secondary disabled" disabled>
                            <span class="dashie-path-icon dashie-path-icon-email">
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
                                </svg>
                            </span>
                            <span class="dashie-path-text">
                                <span class="dashie-path-label">Sign in with Email</span>
                                <span class="dashie-path-desc">Coming soon</span>
                            </span>
                        </button>
                    </div>

                    <div class="dashie-login-footer">
                        <div class="dashie-login-legal">
                            <a href="https://dashieapp.com/privacy-policy.html" target="_blank" rel="noopener">Privacy Policy</a>
                            <span class="dashie-legal-sep">&bull;</span>
                            <a href="https://dashieapp.com/terms-of-service.html" target="_blank" rel="noopener">Terms of Service</a>
                        </div>
                        <div class="dashie-login-version" id="dashie-login-version"></div>
                    </div>
                </div>
            </div>
        `;
        this._populateLoginVersion();
        document.getElementById('sidebar').style.display = 'none';
    },

    async _populateLoginVersion() {
        const el = document.getElementById('dashie-login-version');
        if (!el) return;
        // Console version is hard-coded for now; add-on exposes its version via /api/runtime.
        const consoleVersion = (window.DASHIE_CONSOLE_VERSION || '0.1.0');
        let text = `Console v${consoleVersion}`;
        if (DashieAuth.isAddonMode) {
            try {
                const info = await fetch(DashieAuth._addonUrl('/api/runtime')).then(r => r.ok ? r.json() : null);
                if (info?.version) text += ` · Add-on v${info.version}`;
            } catch (e) { /* ignore */ }
        }
        el.textContent = text;
    },

    async _handleAddonSignIn() {
        try {
            const link = await DashieAuth._signInAddonMode();
            this._showAddonWaitingScreen(link);
        } catch (e) {
            console.error('[App] Sign-in start failed:', e);
            if (typeof Toast !== 'undefined') Toast.error('Could not start sign-in. Please try again.');
        }
    },

    _showAddonWaitingScreen(link) {
        const card = document.getElementById('login-card');
        if (!card) return;
        card.innerHTML = `
            <img src="assets/dashie-logo-orange.png" alt="Dashie" class="dashie-login-logo">
            <div class="dashie-login-title">Sign in with your Dashie account</div>
            <div class="dashie-login-subtitle">
                Tap the button below to open the sign-in page in a new tab.
                This screen will update once you've finished.
            </div>

            <div class="dashie-login-buttons">
                <a href="${link.verification_url}" target="_blank" rel="noopener"
                   class="dashie-path-btn primary" style="text-decoration: none;">
                    <span class="dashie-path-icon">
                        <svg width="36" height="36" viewBox="0 0 48 48">
                            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                        </svg>
                    </span>
                    <span class="dashie-path-text">
                        <span class="dashie-path-label">Open sign-in page</span>
                        <span class="dashie-path-desc">Opens in a new tab</span>
                    </span>
                </a>
            </div>

            <div class="dashie-link-code-box" style="margin-top: 20px;">
                <div class="dashie-link-code-label">Verification Code</div>
                <div class="dashie-link-code-value">${link.user_code}</div>
            </div>

            <div class="dashie-link-waiting">
                <div class="dashie-link-spinner"></div>
                <span>Waiting for approval…</span>
            </div>

            <div style="margin-top: 12px; display: flex; justify-content: center;">
                <button class="btn btn-ghost btn-sm" onclick="App._cancelAddonSignIn()">Cancel</button>
            </div>

            <div class="dashie-login-footer">
                <div class="dashie-login-legal">
                    <a href="https://dashieapp.com/privacy-policy.html" target="_blank" rel="noopener">Privacy Policy</a>
                    <span class="dashie-legal-sep">&bull;</span>
                    <a href="https://dashieapp.com/terms-of-service.html" target="_blank" rel="noopener">Terms of Service</a>
                </div>
                <div class="dashie-login-version" id="dashie-login-version"></div>
            </div>
        `;
        this._populateLoginVersion();
    },

    async _cancelAddonSignIn() {
        await DashieAuth.cancelSignIn();
        this._showLogin();
    },

    _showApp() {
        document.getElementById('sidebar').style.display = '';

        // Update mock user data from real auth if available
        if (DashieAuth.user) {
            const stored = this._getStoredUserData();
            if (stored) {
                MockData.user.email = stored.email || DashieAuth.user.email;
                MockData.user.name = stored.name || '';
                MockData.user.initials = this._getInitials(MockData.user.name || MockData.user.email);
            } else {
                MockData.user.email = DashieAuth.user.email;
                MockData.user.initials = this._getInitials(DashieAuth.user.email);
            }
        }

        // Check URL hash for initial page
        const hash = window.location.hash.replace('#', '');
        if (hash && this.pages[hash]) {
            this._currentPage = hash;
        }

        this.renderPage();

        // Listen for hash changes
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.replace('#', '');
            if (hash && this.pages[hash] && hash !== this._currentPage) {
                this._currentPage = hash;
                this.renderPage();
            }
        });
    },

    _getStoredUserData() {
        try {
            const data = localStorage.getItem('dashie-user-data');
            return data ? JSON.parse(data) : null;
        } catch (e) { return null; }
    },

    _getInitials(str) {
        if (!str) return '?';
        const parts = str.split(/[\s@]+/);
        if (parts.length >= 2 && parts[0] && parts[1]) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return str[0].toUpperCase();
    },

    navigate(page) {
        if (!this.pages[page]) return;

        // Reset sub-page state when navigating away
        if (this._currentPage === 'devices' && page !== 'devices') {
            DevicesPage._detailDeviceId = null;
        }
        if (this._currentPage === 'family' && page !== 'family') {
            FamilyPage._editingId = null;
        }

        this._currentPage = page;
        window.location.hash = page;
        this.closeSidebar();

        // If page has a refresh method, call it to re-fetch fresh data
        const pageObj = this.pages[page]?.page;
        if (pageObj && typeof pageObj.onNavigateTo === 'function') {
            pageObj.onNavigateTo();
        }

        this.renderPage();
    },

    renderPage() {
        const entry = this.pages[this._currentPage];
        if (!entry) return;

        const pageObj = entry.page;

        // Sidebar
        document.getElementById('sidebar').innerHTML = Sidebar.render(this._currentPage);

        // Top bar
        const title = pageObj.topBarTitle ? pageObj.topBarTitle() : this._currentPage;
        const subtitle = pageObj.topBarSubtitle ? pageObj.topBarSubtitle() : '';

        let topBarHtml = TopBar.render(title, subtitle);

        // Inject action buttons if page provides them
        if (pageObj.topBarActions) {
            const actionsHtml = pageObj.topBarActions();
            topBarHtml = topBarHtml.replace(
                '<div class="top-bar-right">',
                `<div class="top-bar-right"><div class="page-header-actions">${actionsHtml}</div>`
            );
        }

        document.getElementById('top-bar').innerHTML = topBarHtml;

        // Content
        document.getElementById('content').innerHTML = pageObj.render();

        // Scroll content to top
        document.getElementById('content').scrollTop = 0;
    },

    toggleSidebar() {
        this._sidebarOpen = !this._sidebarOpen;
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('open', this._sidebarOpen);

        let overlay = document.querySelector('.sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            overlay.onclick = () => this.closeSidebar();
            document.getElementById('app').appendChild(overlay);
        }
        overlay.classList.toggle('visible', this._sidebarOpen);
    },

    closeSidebar() {
        this._sidebarOpen = false;
        document.getElementById('sidebar').classList.remove('open');
        const overlay = document.querySelector('.sidebar-overlay');
        if (overlay) overlay.classList.remove('visible');
    },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
