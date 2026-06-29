/* ============================================================
   Feature Gate — beta visibility rules for the Dashie Console.

   See .reference/FEATURE_GATING.md for the canonical model.

   Rules (composable, per-feature key):

   1. 'alpha-only' — runtime gate via user_profiles.special_access.
      Visible only when DashieAuth.specialAccess === 'alpha'.
      Hidden for default-beta users (i.e. fresh signups, the cohort that
      gets the cloud beta without AI/voice/billing access). This is the
      primary gate for cloud-beta hiding of voice/AI/credits.

   2. 'addon'      — visible only inside the HA add-on (Ingress).
      Used for features that depend on the HA integration runtime
      (HA media browser, etc.).

   3. 'dev'        — visible only when talking to the dev Supabase
      project. Used for features still under active development that
      we don't want loose in prod.

   4. true / false — hard show / hard hide.

   Usage:
       FeatureGate.shouldShow('voiceAi')   // boolean
       FeatureGate.isAddonMode()           // bool
       FeatureGate.isAlphaUser()           // bool
       FeatureGate.isDevEnv()              // bool

   Adding a new gated feature: add a key + rule to FEATURE_RULES.
   ============================================================ */

const FeatureGate = {
    /** Truthy when running embedded inside the HA add-on (Ingress). */
    isAddonMode() {
        return typeof DashieAuth !== 'undefined' && DashieAuth.isAddonMode === true;
    },

    /**
     * Truthy when the console is talking to the development Supabase project.
     *
     * Single check that covers both modes:
     * - Standalone web: DashieAuth.config picks dev vs prod by hostname.
     * - Add-on mode:    DashieAuth.config is whatever the add-on reports.
     * In both cases the dev project URL contains 'cwglbtos' (development
     * supabase project ref); prod is 'cseaywxc'.
     */
    isDevEnv() {
        const url = (typeof DashieAuth !== 'undefined' && DashieAuth.config?.url) || '';
        return url.includes('cwglbtos');
    },

    /**
     * Truthy when the signed-in user has alpha-tier feature access (i.e.
     * user_profiles.special_access === 'alpha'). The 'developer' tier
     * also counts — developers get full access regardless of rollout.
     *
     * Notes on initial paint:
     * - DashieAuth.loadUserProfile() runs async after auth establishes.
     *   Until it resolves, specialAccess is null and this returns false.
     *   That means alpha-gated UI is hidden during the brief moment
     *   before the profile loads — App.init re-renders once load completes
     *   so the UI corrects itself.
     */
    isAlphaUser() {
        if (typeof DashieAuth === 'undefined') return false;
        if (DashieAuth.tier === 'developer') return true;
        return DashieAuth.specialAccess === 'alpha';
    },

    /**
     * Per-feature visibility rules.
     *   true              → always visible
     *   false             → always hidden (not ready for beta)
     *   'addon'           → visible only when isAddonMode()
     *   'dev'             → visible only when isDevEnv()
     *   'alpha-only'      → visible only when isAlphaUser()
     */
    FEATURE_RULES: {
        // Voice / AI features depend on Dashie Cloud token spend, which
        // beta users don't have. Alpha users (admin-promoted) see them.
        voiceAi:    'alpha-only',
        videoFeeds: 'alpha-only',

        // Credits / token-bank / BYOK surfaces — same cohort gate as
        // voice/AI. Beta users have a flat subscription; credits don't
        // apply to them.
        credits:    'alpha-only',

        // Locations / GPS is alpha-only per the feature_access catalog —
        // mirror that gate here so the Console matches the dashboard.
        locations:  'alpha-only',

        // Chores & rewards are alpha-only — they're not part of the beta
        // Cloud product. Mirrors the dashboard's feature_access catalog.
        chores:     'alpha-only',
        rewards:    'alpha-only',

        // Scheduled Actions (voice reminders) — alpha-only, mirrors the
        // dashboard's feature_access 'scheduled_actions' catalog entry.
        scheduledActions: 'alpha-only',
    },

    shouldShow(key) {
        const rule = this.FEATURE_RULES[key];
        if (rule === undefined) return true;        // unknown key → visible (safer)
        if (rule === true)  return true;
        if (rule === false) return false;
        if (rule === 'addon')      return this.isAddonMode();
        if (rule === 'dev')        return this.isDevEnv();
        if (rule === 'alpha-only') return this.isAlphaUser();
        return true;
    },

    /**
     * Map of console route → feature key (for nav gating + redirect-to-home
     * on direct URL hits to a hidden page). Routes not in this map are
     * always shown.
     */
    PAGE_FEATURE: {
        'voice-ai':    'voiceAi',
        'video-feeds': 'videoFeeds',
        'locations':   'locations',
        'chores':      'chores',
        'rewards':     'rewards',
        'scheduled-actions': 'scheduledActions',
    },

    /**
     * Pages that require a current subscription / trial entitlement.
     * When the SubscribeGate detects expired state, these are hidden from
     * the sidebar until the user subscribes. Account and Devices are
     * intentionally excluded — the user needs to reach Account to subscribe
     * or manage; Devices is read-only-ish and useful even for an expired
     * account.
     */
    ENTITLEMENT_GATED_PAGES: new Set([
        'family', 'calendar', 'photos',
        'chores', 'rewards', 'locations',
        'voice-ai', 'video-feeds',
    ]),

    /** Subscription state — set by SubscribeGate after check-subscription. */
    _subscriptionState: null,

    /**
     * Called by SubscribeGate when the subscription check resolves.
     * Updates the entitlement-valid flag and triggers a sidebar re-render
     * so newly-hidden items disappear on the same tick.
     */
    setSubscriptionState(state) {
        this._subscriptionState = state || null;
        if (typeof App !== 'undefined' && App.renderPage) App.renderPage();
    },

    /** True if the user currently has a valid entitlement. Optimistic
     *  default (true) so we don't flash-hide items during initial load. */
    hasEntitlement() {
        const state = this._subscriptionState;
        if (!state) return true; // optimistic — assume entitled until told otherwise
        const status = state.subscription_status;
        if (status === 'trial_expired') return false;
        if (status === 'canceled') {
            const exp = state.tier_expires_at ? new Date(state.tier_expires_at).getTime() : 0;
            return !(exp > 0 && exp < Date.now());
        }
        return true;
    },

    /** True if the given page route should be visible in the current env. */
    isPageEnabled(page) {
        const key = this.PAGE_FEATURE[page];
        if (key && !this.shouldShow(key)) return false;
        if (!this.hasEntitlement() && this.ENTITLEMENT_GATED_PAGES.has(page)) return false;
        return true;
    },
};
