/* ============================================================
   Dashie Console — Auth (self-contained, no module imports)
   Calls the same edge function endpoints as the main app:
   - jwt-auth: exchange_code, bootstrap_jwt, refresh_jwt
   - database-operations: all household/device operations
   ============================================================ */

const DashieAuth = {
    // --- Config (auto-detect environment by hostname) ---
    _configs: {
        production: {
            url: 'https://cseaywxcvnxcsypaqaid.supabase.co',
            anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzZWF5d3hjdm54Y3N5cGFxYWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2MDIxOTEsImV4cCI6MjA3MzE3ODE5MX0.Wnd7XELrtPIDKeTcHVw7dl3awn3BlI0z9ADKPgSfHhA',
            googleClientId: '221142210647-58t8hr48rk7nlgl56j969himso1qjjoo.apps.googleusercontent.com',
        },
        development: {
            url: 'https://cwglbtosingboqepsmjk.supabase.co',
            anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3Z2xidG9zaW5nYm9xZXBzbWprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NDY4NjYsImV4cCI6MjA3MzIyMjg2Nn0.VCP5DSfAwwZMjtPl33bhsixSiu_lHsM6n42FMJRP3YA',
            googleClientId: '221142210647-58t8hr48rk7nlgl56j969himso1qjjoo.apps.googleusercontent.com',
        },
    },

    _getConfig() {
        // In add-on mode, prefer the Supabase config the add-on reports (matches
        // whatever env the add-on's stored JWT was issued against). The add-on
        // populates this._addonSupabaseConfig in _initAddonMode().
        if (this._addonSupabaseConfig) return this._addonSupabaseConfig;

        const host = window.location.hostname;
        if (host.includes('dev.') || host.includes('local.') || host === 'localhost' || host.startsWith('127.0.0.1')) {
            return this._configs.development;
        }
        return this._configs.production;
    },

    get config() {
        // Don't cache — _addonSupabaseConfig may be populated after first access.
        return this._getConfig();
    },

    _addonSupabaseConfig: null,
    get edgeFunctionUrl() { return this.config.url + '/functions/v1/jwt-auth'; },
    get databaseOpsUrl() { return this.config.url + '/functions/v1/database-operations'; },
    get anonKey() { return this.config.anonKey; },

    // --- JWT State ---
    jwt: null,
    jwtExpiry: null,
    jwtUserId: null,
    jwtUserEmail: null,
    _refreshTimer: null,
    _JWT_STORAGE_KEY: 'dashie-supabase-jwt',
    _REFRESH_THRESHOLD_HOURS: 24,

    // --- Callbacks ---
    onAuthStateChange: null,  // called with (isAuthenticated, user)

    // --- Realtime client (for broadcasts) ---
    _supabaseClient: null,
    _sessionId: null,              // per-page-load session ID for broadcast filtering
    _channels: {},                 // map channelName -> { channel, ready, handlers: { event: [fn] } }

    /** Lazily initialize a Supabase client for realtime broadcasts */
    _getSupabaseClient() {
        if (this._supabaseClient) return this._supabaseClient;
        if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
            console.warn('[DashieAuth] Supabase JS SDK not loaded; broadcasts unavailable');
            return null;
        }
        this._supabaseClient = window.supabase.createClient(this.config.url, this.anonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            realtime: { params: { eventsPerSecond: 10 } },
        });
        if (this.jwt) this._supabaseClient.realtime.setAuth(this.jwt);
        return this._supabaseClient;
    },

    /** Get a stable per-tab session ID for broadcast self-filtering */
    getSessionId() {
        if (this._sessionId) return this._sessionId;
        this._sessionId = `console-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
        return this._sessionId;
    },

    /**
     * Get or create a persistent channel for the given base name.
     * Keeps one subscription per channel — both broadcast sending and
     * receiving go through the same channel, matching the mobile app pattern.
     */
    async _getOrCreateChannel(channelBase) {
        const sb = this._getSupabaseClient();
        if (!sb || !this.jwtUserId) return null;
        const channelName = `${channelBase}-${this.jwtUserId}`;

        if (this._channels[channelName]?.ready) {
            return this._channels[channelName];
        }

        if (this._channels[channelName]?.readyPromise) {
            await this._channels[channelName].readyPromise;
            return this._channels[channelName];
        }

        const channel = sb.channel(channelName, {
            config: { broadcast: { self: false, ack: false } },
        });
        const entry = { channel, ready: false, handlers: {} };
        this._channels[channelName] = entry;

        // Register a single broadcast listener that fans out to per-event handlers
        channel.on('broadcast', { event: '*' }, (payload) => {
            const event = payload.event;
            const p = payload.payload;
            if (p?.sessionId === this.getSessionId()) return; // self-filter
            const handlers = entry.handlers[event] || [];
            for (const fn of handlers) {
                try { fn(p); } catch (e) { console.error('[DashieAuth] broadcast handler error', e); }
            }
        });

        entry.readyPromise = new Promise((resolve) => {
            channel.subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    entry.ready = true;
                    resolve();
                }
            });
        });

        await entry.readyPromise;
        return entry;
    },

    /** Broadcast on a user-scoped channel (persistent underneath) */
    async broadcast(channelBase, event, payload) {
        try {
            const entry = await this._getOrCreateChannel(channelBase);
            if (!entry) return false;
            await entry.channel.send({
                type: 'broadcast',
                event,
                payload: { ...payload, userId: this.jwtUserId, sessionId: this.getSessionId() },
            });
            return true;
        } catch (e) {
            console.warn('[DashieAuth] broadcast failed', e);
            return false;
        }
    },

    /** Subscribe to broadcast events on a user-scoped channel */
    async subscribeToChannel(channelBase, event, handler) {
        const entry = await this._getOrCreateChannel(channelBase);
        if (!entry) return null;
        entry.handlers[event] = entry.handlers[event] || [];
        entry.handlers[event].push(handler);
        return { channelBase, event, handler };
    },

    /** Unsubscribe a handler from a broadcast channel */
    unsubscribeFromChannel(ticket) {
        if (!ticket) return;
        const channelName = `${ticket.channelBase}-${this.jwtUserId}`;
        const entry = this._channels[channelName];
        if (!entry?.handlers[ticket.event]) return;
        entry.handlers[ticket.event] = entry.handlers[ticket.event].filter(h => h !== ticket.handler);
    },

    /** Load account-level user_settings (via jwt-auth edge function) */
    async loadUserSettings() {
        const data = await this._authRequest({ operation: 'load' });
        return data.settings || {};
    },

    /** Save (upsert) the full user_settings object */
    async saveUserSettings(fullSettings) {
        return this._authRequest({ operation: 'save', data: fullSettings });
    },

    // =========================================================
    //  Add-on mode detection
    //  When served by Dashie Hub (Node/Express HA add-on), the SPA takes its
    //  JWT from /api/auth/jwt and drives sign-in via the device-flow
    //  endpoints. In browser-only mode, it uses Google OAuth directly.
    // =========================================================

    _addonMode: null,         // null = unknown, true/false after probe
    _addonRuntimeInfo: null,  // cached result of GET /api/runtime

    /**
     * Build an add-on API URL that works under any page prefix (Ingress uses dynamic
     * paths like /api/hassio_ingress/<token>/). Using relative paths resolves against
     * document.baseURI, which is correct whether we're at http://localhost:7123/
     * or https://<ha>/api/hassio_ingress/<token>/.
     */
    _addonUrl(path) {
        return path.replace(/^\//, '');  // 'api/runtime' — browser resolves via baseURI
    },

    async _probeAddonMode() {
        if (this._addonMode !== null) return this._addonMode;
        try {
            const resp = await fetch(this._addonUrl('/api/runtime'), { cache: 'no-store' });
            if (resp.ok) {
                const data = await resp.json();
                if (data?.addon === true) {
                    this._addonMode = true;
                    this._addonRuntimeInfo = data;
                    console.log('[DashieAuth] Running inside Dashie Hub', data);
                    return true;
                }
            }
        } catch (e) { /* not running inside the add-on */ }
        this._addonMode = false;
        return false;
    },

    get isAddonMode() {
        // Synchronous accessor — only reliable after init() completes
        return this._addonMode === true;
    },

    // =========================================================
    //  Initialization
    // =========================================================

    async init() {
        // Detect add-on mode FIRST — changes everything downstream
        await this._probeAddonMode();

        if (this._addonMode) {
            return await this._initAddonMode();
        }

        // Browser-only mode (original path)
        this._loadJWTFromStorage();

        // Check if we're returning from an OAuth callback
        const params = new URLSearchParams(window.location.search);
        if (params.has('code') && params.has('state')) {
            return this._handleOAuthCallback(params);
        }

        return this.isAuthenticated;
    },

    /** In add-on mode: fetch server-stored auth state; pull JWT from /api/auth/jwt. */
    async _initAddonMode() {
        try {
            const status = await fetch(this._addonUrl('/api/auth/status')).then(r => r.json());

            // Always capture the add-on's Supabase config (even when not authenticated)
            // so subsequent edge-function calls target the right project.
            if (status?.supabase_url && status?.supabase_anon_key) {
                this._addonSupabaseConfig = {
                    url: status.supabase_url,
                    anonKey: status.supabase_anon_key,
                    googleClientId: this._configs[status.supabase_env === 'production' ? 'production' : 'development'].googleClientId,
                };
                console.log('[DashieAuth] Using Supabase from add-on:', status.supabase_env, status.supabase_url);
            }

            if (status?.authenticated) {
                // Pull the actual JWT from the add-on
                const jwtResp = await fetch(this._addonUrl('/api/auth/jwt'));
                if (jwtResp.ok) {
                    const data = await jwtResp.json();
                    this._setJWTFromAddon(data.jwt, {
                        id: status.user_id,
                        email: status.user_email,
                        name: status.user_name,
                    });
                    return true;
                }
            }
        } catch (e) {
            console.error('[DashieAuth] Failed to init add-on mode', e);
        }
        return false;
    },

    /** Set JWT without localStorage persistence (add-on handles persistence server-side). */
    _setJWTFromAddon(token, user) {
        this.jwt = token;
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            this.jwtExpiry = payload.exp ? payload.exp * 1000 : null;
            this.jwtUserId = user?.id || payload.sub;
            this.jwtUserEmail = user?.email || payload.email;
        } catch (e) {
            console.error('[DashieAuth] Failed to parse add-on JWT', e);
        }
        // Schedule re-fetch from add-on a bit before expiry rather than client-side refresh
        this._scheduleAddonJWTRefresh();
        if (this._supabaseClient) this._supabaseClient.realtime.setAuth(token);
        // Seed the user-data localStorage entry the SPA uses for display
        try {
            if (user?.name || user?.email) {
                localStorage.setItem('dashie-user-data', JSON.stringify({
                    name: user?.name || '',
                    email: user?.email || '',
                    picture: '',
                }));
            }
        } catch (e) {}
    },

    _scheduleAddonJWTRefresh() {
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        if (!this.jwtExpiry) return;
        // Re-fetch from add-on when within 30 min of expiry (the add-on handles
        // the actual refresh itself)
        const delay = Math.max(60_000, this.jwtExpiry - Date.now() - 30 * 60 * 1000);
        this._refreshTimer = setTimeout(() => this._refetchAddonJWT(), delay);
    },

    async _refetchAddonJWT() {
        try {
            const resp = await fetch(this._addonUrl('/api/auth/jwt'));
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this._setJWTFromAddon(data.jwt, {
                id: this.jwtUserId,
                email: this.jwtUserEmail,
            });
            console.log('[DashieAuth] JWT re-fetched from add-on');
        } catch (e) {
            console.error('[DashieAuth] Add-on JWT re-fetch failed', e);
            this._refreshTimer = setTimeout(() => this._refetchAddonJWT(), 5 * 60 * 1000);
        }
    },

    // =========================================================
    //  JWT Management (mirrors EdgeClient)
    // =========================================================

    get isAuthenticated() {
        if (!this.jwt) return false;
        if (this.jwtExpiry && Date.now() >= this.jwtExpiry) return false;
        return true;
    },

    get user() {
        if (!this.isAuthenticated) return null;
        return {
            id: this.jwtUserId,
            email: this.jwtUserEmail,
        };
    },

    setJWT(token) {
        this.jwt = token;
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            this.jwtExpiry = payload.exp ? payload.exp * 1000 : null;
            this.jwtUserId = payload.sub;
            this.jwtUserEmail = payload.email;
        } catch (e) {
            console.error('[DashieAuth] Failed to parse JWT', e);
        }
        this._saveJWTToStorage();
        this._scheduleRefresh();
        if (this._supabaseClient) this._supabaseClient.realtime.setAuth(token);
    },

    clearJWT() {
        this.jwt = null;
        this.jwtExpiry = null;
        this.jwtUserId = null;
        this.jwtUserEmail = null;
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
        try { localStorage.removeItem(this._JWT_STORAGE_KEY); } catch (e) {}
        if (this.onAuthStateChange) this.onAuthStateChange(false, null);
    },

    _loadJWTFromStorage() {
        try {
            const stored = localStorage.getItem(this._JWT_STORAGE_KEY);
            if (!stored) return;
            const data = JSON.parse(stored);
            if (Date.now() >= data.expiry) {
                localStorage.removeItem(this._JWT_STORAGE_KEY);
                return;
            }
            this.jwt = data.jwt;
            this.jwtExpiry = data.expiry;
            this.jwtUserId = data.userId;
            this.jwtUserEmail = data.userEmail;
            this._scheduleRefresh();
        } catch (e) {
            localStorage.removeItem(this._JWT_STORAGE_KEY);
        }
    },

    _saveJWTToStorage() {
        if (!this.jwt || !this.jwtExpiry) return;
        try {
            localStorage.setItem(this._JWT_STORAGE_KEY, JSON.stringify({
                jwt: this.jwt,
                expiry: this.jwtExpiry,
                userId: this.jwtUserId,
                userEmail: this.jwtUserEmail,
                savedAt: Date.now(),
            }));
        } catch (e) {
            console.error('[DashieAuth] Failed to save JWT', e);
        }
    },

    _scheduleRefresh() {
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        if (!this.jwtExpiry) return;

        const thresholdMs = this._REFRESH_THRESHOLD_HOURS * 60 * 60 * 1000;
        const delayMs = Math.max(0, (this.jwtExpiry - thresholdMs) - Date.now());

        if (delayMs <= 0) {
            // Already within threshold — refresh in 5s
            this._refreshTimer = setTimeout(() => this._refreshJWT(), 5000);
        } else {
            this._refreshTimer = setTimeout(() => this._refreshJWT(), delayMs);
        }
    },

    async _refreshJWT() {
        if (!this.jwt) return;
        try {
            const data = await this._authRequest({ operation: 'refresh_jwt' });
            if (data.jwtToken) {
                this.setJWT(data.jwtToken);
                console.log('[DashieAuth] JWT refreshed');
            }
        } catch (e) {
            console.error('[DashieAuth] JWT refresh failed', e);
            // Retry in 1 hour if not expired
            if (this.jwtExpiry && Date.now() < this.jwtExpiry) {
                this._refreshTimer = setTimeout(() => this._refreshJWT(), 60 * 60 * 1000);
            }
        }
    },

    // =========================================================
    //  Google OAuth Flow
    // =========================================================

    signIn() {
        // Add-on mode: use device flow via /api/auth/start-link
        if (this.isAddonMode) return this._signInAddonMode();

        // Browser-only mode: standard Google OAuth redirect
        sessionStorage.setItem('dashie-oauth-state', Date.now().toString());
        const redirectUri = this._getRedirectUri();
        const params = new URLSearchParams({
            client_id: this.config.googleClientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'profile email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive',
            access_type: 'offline',
            prompt: 'consent',
            state: Date.now().toString(),
            include_granted_scopes: 'true',
        });
        window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    },

    // --- Add-on device flow ---

    _addonPendingLink: null,    // { user_code, verification_url, expires_at }
    _addonPollTimer: null,

    /**
     * Start the device-flow sign-in. Returns { verification_url, user_code }.
     * DOES NOT open the verification URL — caller (the sign-in UI) renders a
     * user-clickable anchor instead. Opening programmatically via window.open
     * is unreliable inside HA Ingress iframes (popup blockers / sandbox may
     * navigate the parent frame instead, which HA rejects with a 403).
     * Polling begins automatically; onAuthStateChange fires on approval.
     */
    async _signInAddonMode() {
        if (this._addonPendingLink && Date.now() < new Date(this._addonPendingLink.expires_at).getTime()) {
            return this._addonPendingLink;
        }
        const resp = await fetch(this._addonUrl('/api/auth/start-link'), { method: 'POST' });
        if (!resp.ok) throw new Error(`start-link failed: ${resp.status}`);
        const link = await resp.json();
        this._addonPendingLink = link;
        this._startAddonPolling();
        return link;
    },

    _startAddonPolling() {
        if (this._addonPollTimer) return;
        const interval = (this._addonPendingLink?.interval || 3) * 1000;
        const tick = async () => {
            try {
                const resp = await fetch(this._addonUrl('/api/auth/poll-link'), { method: 'POST' });
                const data = await resp.json();
                if (data.status === 'authorized') {
                    this._stopAddonPolling();
                    this._addonPendingLink = null;
                    await this._initAddonMode();  // pulls the newly-stored JWT
                    if (this.onAuthStateChange) {
                        this.onAuthStateChange(true, {
                            id: data.user_id,
                            email: data.user_email,
                            name: data.user_name,
                        });
                    }
                    return;
                }
                if (data.status === 'expired' || data.status === 'none') {
                    this._stopAddonPolling();
                    this._addonPendingLink = null;
                    if (this.onAuthStateChange) this.onAuthStateChange(false, null);
                    return;
                }
                // pending — schedule next tick
                this._addonPollTimer = setTimeout(tick, interval);
            } catch (e) {
                console.error('[DashieAuth] Poll error', e);
                this._addonPollTimer = setTimeout(tick, interval * 2);
            }
        };
        this._addonPollTimer = setTimeout(tick, interval);
    },

    _stopAddonPolling() {
        if (this._addonPollTimer) clearTimeout(this._addonPollTimer);
        this._addonPollTimer = null;
    },

    /** Cancel a pending device-flow sign-in (user closed the sign-in page or hit Cancel). */
    async cancelSignIn() {
        this._stopAddonPolling();
        this._addonPendingLink = null;
        if (this.isAddonMode) {
            try { await fetch(this._addonUrl('/api/auth/cancel-link'), { method: 'POST' }); } catch (e) {}
        }
    },

    async signOut() {
        if (this.isAddonMode) {
            try { await fetch(this._addonUrl('/api/auth/sign-out'), { method: 'POST' }); } catch (e) {}
        }
        this.clearJWT();
        this._stopAddonPolling();
        this._addonPendingLink = null;
        try {
            localStorage.removeItem('dashie-user-data');
            localStorage.removeItem('dashie-family-name');
        } catch (e) {}
    },

    _getRedirectUri() {
        const hostname = window.location.hostname;

        // Local dev via Cloudflare tunnel (local.dashieapp.com → localhost:3000)
        // Serves console at local.dashieapp.com/console, login callback at /console/login
        if (hostname.includes('local.dashieapp.com')) {
            return window.location.origin + '/console/login';
        }

        // Production/staging — /console/login handled by Vercel rewrite
        return window.location.origin + '/console/login';
    },

    async _handleOAuthCallback(params) {
        const code = params.get('code');
        const error = params.get('error');

        // Clean URL immediately
        window.history.replaceState({}, document.title, window.location.pathname);
        sessionStorage.removeItem('dashie-oauth-state');

        if (error) {
            throw new Error(`OAuth error: ${error}`);
        }

        if (!code) return false;

        try {
            // 1. Exchange code for Google tokens via edge function
            const tokens = await this._exchangeCode(code);

            // 2. Fetch Google user info
            const userInfo = await this._fetchGoogleUserInfo(tokens.access_token);

            // 3. Bootstrap Supabase JWT from Google access token
            const jwtResult = await this._bootstrapJWT(tokens.access_token);

            // Store user data for display
            try {
                localStorage.setItem('dashie-user-data', JSON.stringify({
                    name: userInfo.name,
                    email: userInfo.email,
                    picture: userInfo.picture,
                }));
            } catch (e) {}

            if (this.onAuthStateChange) {
                this.onAuthStateChange(true, { ...userInfo, ...jwtResult.user });
            }

            return true;
        } catch (e) {
            console.error('[DashieAuth] OAuth callback failed', e);
            throw e;
        }
    },

    async _exchangeCode(code) {
        const response = await fetch(this.edgeFunctionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.anonKey}`,
            },
            body: JSON.stringify({
                operation: 'exchange_code',
                data: {
                    code: code,
                    redirect_uri: this._getRedirectUri(),
                    provider_type: 'web_oauth',
                },
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(`Token exchange failed: ${response.status} - ${err.error || err.details || 'Unknown'}`);
        }

        const result = await response.json();
        if (!result.success || !result.tokens) {
            throw new Error('Token exchange failed: no tokens returned');
        }
        return result.tokens;
    },

    async _fetchGoogleUserInfo(accessToken) {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        if (!response.ok) throw new Error(`Failed to fetch user info: ${response.status}`);
        return response.json();
    },

    async _bootstrapJWT(googleAccessToken) {
        const response = await fetch(this.edgeFunctionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.anonKey}`,
            },
            body: JSON.stringify({
                operation: 'bootstrap_jwt',
                googleAccessToken: googleAccessToken,
                provider: 'google',
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            if (response.status === 403 && err.error === 'access_denied') {
                throw new Error(err.message || err.reason || 'Access denied');
            }
            throw new Error(`JWT bootstrap failed: ${response.status} - ${err.error || 'Unknown'}`);
        }

        const data = await response.json();
        if (!data.success || !data.jwtToken) {
            throw new Error('JWT bootstrap failed: no token returned');
        }

        this.setJWT(data.jwtToken);
        return { user: data.user, access: data.access };
    },

    // =========================================================
    //  Authenticated Requests (mirrors EdgeClient.request/databaseRequest)
    // =========================================================

    /**
     * Call jwt-auth edge function with auth
     */
    async authRequest(payload) {
        return this._authRequest(payload);
    },

    /**
     * Call database-operations edge function with auth
     */
    async dbRequest(operation, data = {}) {
        if (!this.jwt) throw new Error('Not authenticated');

        const response = await fetch(this.databaseOpsUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.jwt}`,
                'apikey': this.anonKey,
            },
            body: JSON.stringify({
                operation: operation,
                data: data,
                jwtToken: this.jwt,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            console.error(`[DashieAuth] dbRequest ${operation} failed ${response.status}:`, err, 'payload:', data);
            const detail = err.error || err.details || err.message || `HTTP ${response.status}`;
            throw new Error(`DB operation failed: ${response.status} - ${detail}`);
        }

        const result = await response.json();
        if (!result.success) {
            console.error(`[DashieAuth] dbRequest ${operation} returned error:`, result, 'payload:', data);
            throw new Error(`DB operation error: ${result.error || 'Unknown'}`);
        }
        return result;
    },

    /**
     * Call any edge function by name with auth
     */
    async edgeFunctionRequest(functionName, body = {}) {
        if (!this.jwt) throw new Error('Not authenticated');

        const url = this.config.url + '/functions/v1/' + functionName;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.jwt}`,
                'apikey': this.anonKey,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(`Edge function ${functionName} failed: ${response.status} - ${err.error || 'Unknown'}`);
        }

        return response.json();
    },

    // Internal: authenticated request to jwt-auth
    async _authRequest(payload) {
        if (!this.jwt) throw new Error('Not authenticated');

        const response = await fetch(this.edgeFunctionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.jwt}`,
                'apikey': this.anonKey,
            },
            body: JSON.stringify({ ...payload, jwtToken: this.jwt }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(`Auth request failed: ${response.status} - ${err.error || 'Unknown'}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(`Auth request error: ${data.error || 'Unknown'}`);
        }
        return data;
    },
};
