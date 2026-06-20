/* ============================================================
   Dashie Console — App Router
   ============================================================ */

const App = {
    _currentPage: 'devices',
    _sidebarOpen: false,

    pages: {
        devices:       { page: DevicesPage },
        preferences:   { page: PreferencesPage },
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
        // If we just landed here after a successful account deletion, show
        // a one-time goodbye toast and strip the query param so a refresh
        // doesn't re-fire it. Done before auth init so it shows even if
        // the rest of init takes time.
        this._consumeDeletedParam();

        // Kick off the dropdown-options catalog fetch. Fire-and-forget —
        // doesn't depend on auth (anon-key access), runs in parallel with
        // everything else. Bundled fallback values are used until the
        // network response lands. See js/lib/option-catalog.js.
        if (typeof OptionCatalog !== 'undefined') OptionCatalog.init();

        // Wire up auth state change callback
        DashieAuth.onAuthStateChange = (isAuth) => {
            if (isAuth) {
                // Kick off profile load (tier + special_access) in parallel
                // with the first paint — FeatureGate's 'alpha-only' rule
                // depends on this. Re-render once it lands so any
                // alpha-gated UI flips visibility correctly.
                DashieAuth.loadUserProfile().then(() => this.renderPage()).catch(() => {});
                this._showApp();
                // Subscribe-prompt gate: if the user has no current entitlement
                // (trial expired / canceled past expiry), show the prompt.
                // Fire-and-forget — runs in background after first paint.
                if (typeof SubscribeGate !== 'undefined') SubscribeGate.checkAndShow();
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
                DashieAuth.loadUserProfile().then(() => this.renderPage()).catch(() => {});
                this._showApp();
                if (typeof SubscribeGate !== 'undefined') SubscribeGate.checkAndShow();
                return;
            }
        } catch (e) {
            console.error('[App] Auth init error:', e);
        }

        if (DashieAuth.isAuthenticated) {
            DashieAuth.loadUserProfile().then(() => this.renderPage()).catch(() => {});
            this._showApp();
            if (typeof SubscribeGate !== 'undefined') SubscribeGate.checkAndShow();
        } else {
            this._showLogin();
        }
    },

    /**
     * One-shot handler for `?deleted=1` query param after a successful
     * Delete Account flow. Shows a goodbye toast, then strips the param so
     * a refresh doesn't re-trigger. Called from init() before auth bootstrap.
     */
    _consumeDeletedParam() {
        try {
            const params = new URLSearchParams(window.location.search);
            if (params.get('deleted') === '1') {
                // Toast may not be loaded if scripts loaded out of order — guard.
                if (typeof Toast !== 'undefined') {
                    Toast.info('Your Dashie account has been deleted. Thanks for trying Dashie.');
                } else {
                    // Fallback for the (unusual) case where Toast hasn't loaded yet
                    setTimeout(() => {
                        if (typeof Toast !== 'undefined') {
                            Toast.info('Your Dashie account has been deleted. Thanks for trying Dashie.');
                        }
                    }, 200);
                }
                params.delete('deleted');
                const newSearch = params.toString();
                const cleanUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
                window.history.replaceState({}, '', cleanUrl);
            }
        } catch (_) { /* non-fatal */ }
    },

    /**
     * Wire SettingsSync to Console's Supabase client + the authenticated
     * user. Console-auth lazily creates a Supabase realtime client for
     * its own broadcasts; we reuse it so we share the websocket. Fires
     * one-shot; subsequent _showApp() calls (re-auth, etc.) are no-ops
     * because SettingsSync.connect() is itself idempotent.
     */
    _connectSettingsSync() {
        try {
            if (!window.SettingsSync) {
                console.warn('[App] SettingsSync not loaded — skipping realtime sync wiring');
                return;
            }
            const userId = DashieAuth.user && DashieAuth.user.id;
            if (!userId) {
                console.warn('[App] SettingsSync wiring skipped — no user id');
                return;
            }
            const sbClient = DashieAuth._getSupabaseClient
                ? DashieAuth._getSupabaseClient()
                : null;
            if (!sbClient) {
                console.warn('[App] SettingsSync wiring skipped — Supabase client unavailable');
                return;
            }
            window.SettingsSync.configure(sbClient, userId);
            window.SettingsSync.connect();
        } catch (e) {
            console.warn('[App] SettingsSync wiring failed (non-fatal)', e && e.message);
        }
    },

    _showLogin() {
        // Tear down any background pollers left running from a previously
        // authed session (devices auto-refresh interval, fresh-device poll,
        // SSE event stream). Otherwise they keep hitting now-unauthenticated
        // endpoints and — before the renderPage() auth guard — would repaint
        // the dashboard over this login screen.
        try { if (typeof DevicesPage !== 'undefined') DevicesPage._stopPollers?.(); } catch (_) {}
        try { if (typeof DevicesEvents !== 'undefined') DevicesEvents.stop?.(); } catch (_) {}

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

        // Connect SettingsSync now that auth is known good. Pages register
        // their consumers on first render — the manager retains them, so
        // ordering between connect() and register() doesn't matter. Fire
        // and forget; failures only mean realtime falls back to TTL.
        this._connectSettingsSync();

        // Update mock user data from real auth if available
        if (DashieAuth.user) {
            const stored = this._getStoredUserData();
            if (stored) {
                MockData.user.email = stored.email || DashieAuth.user.email;
                MockData.user.name = stored.name || '';
                MockData.user.picture = stored.picture || '';
                MockData.user.initials = this._getInitials(MockData.user.name || MockData.user.email);
            } else {
                MockData.user.email = DashieAuth.user.email;
                MockData.user.picture = '';
                MockData.user.initials = this._getInitials(DashieAuth.user.email);
            }
        }

        // Check URL hash for initial page. If the hash points at a beta-gated
        // page that's hidden in this env, fall back to home and silently
        // rewrite the URL.
        const hash = window.location.hash.replace('#', '');
        if (hash && this.pages[hash] && FeatureGate.isPageEnabled(hash)) {
            this._currentPage = hash;
        } else if (hash) {
            // Quietly redirect — no toast, no error; user may have an old
            // bookmark or a link from a different env.
            window.location.hash = this._currentPage;
        }

        this.renderPage();
        this._resetContentScroll();

        // Kick off a balance fetch so the sidebar's credits widget shows
        // the real number on first paint. CreditsService re-renders the
        // sidebar in place once the result lands; the rest of the page
        // doesn't need to wait.
        window.CreditsService?.fetch();

        // Listen for hash changes
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.replace('#', '');
            if (hash && this.pages[hash] && hash !== this._currentPage) {
                if (!FeatureGate.isPageEnabled(hash)) {
                    window.location.hash = this._currentPage;
                    return;
                }
                this._currentPage = hash;
                this.renderPage();
                this._resetContentScroll();
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
        // Silently redirect to home if the user (or a stale link) targets a
        // beta-gated page that's hidden in this environment.
        if (!FeatureGate.isPageEnabled(page)) {
            page = 'devices';
        }

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
        this._resetContentScroll();
    },

    renderPage() {
        // Auth guard (the "auto logs back in after sign-out" fix): background
        // tasks call renderPage() asynchronously — the devices page's
        // _pollUntilFreshDevices / auto-refresh timers, SSE events, the credits
        // fetch, the option catalog, FeatureGate. If the user signed out while
        // one was in flight, it would otherwise repaint an authed page straight
        // over the login screen ~1s later, looking exactly like an auto-login.
        // renderPage only ever renders authed pages; the login UI is drawn by
        // _showLogin(), so bailing here when signed out is always correct.
        if (!DashieAuth.isAuthenticated) return;

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
        // No scroll reset here — `renderPage` is also called for in-place
        // state updates (e.g. toggling hide on a calendar row), and resetting
        // scroll mid-page is jarring. Navigation paths handle scroll reset
        // explicitly via `_resetContentScroll()`.
    },

    _resetContentScroll() {
        const el = document.getElementById('content');
        if (el) el.scrollTop = 0;
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
