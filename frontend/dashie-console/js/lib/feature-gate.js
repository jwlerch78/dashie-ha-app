/* ============================================================
   Feature Gate — beta visibility rules for the Dashie Console.

   Two orthogonal gates:

   1. HA-only features (voice-pipeline, video-feeds): visible only when
      the console is running INSIDE the HA add-on (DashieAuth.isAddonMode).
      Hidden on the public website (dashieapp.com/console) for beta because
      these features depend on the HA integration.

   2. Dev-only features (credits / token-bank / cloud-AI surfaces): visible
      only in the development supabase environment. Active development
      continues during beta but the UI is hidden in prod until ready.

   Plus a "not ready for beta" bucket — hidden everywhere until the
   feature work is complete (e.g. Locations).

   Usage:
       FeatureGate.shouldShow('voiceAi')   // boolean
       FeatureGate.isAddonMode()
       FeatureGate.isDevEnv()

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
     * Per-feature visibility rules.
     *   true              → always visible
     *   false             → always hidden (not ready for beta)
     *   'addon'           → visible only when isAddonMode()
     *   'dev'             → visible only when isDevEnv()
     */
    FEATURE_RULES: {
        // HA-only features — surface only inside the add-on. The website
        // beta hides them since they depend on the HA integration.
        voiceAi:    'addon',
        videoFeeds: 'addon',

        // Dev-only — credits / cloud-AI / token-bank surfaces are still in
        // active development. Visible in staging/local for dev iteration,
        // hidden in prod until the backend is ready.
        credits:    'dev',

        // Not ready for beta — hidden everywhere until the feature lands.
        locations:  false,
    },

    shouldShow(key) {
        const rule = this.FEATURE_RULES[key];
        if (rule === undefined) return true;        // unknown key → visible (safer)
        if (rule === true)  return true;
        if (rule === false) return false;
        if (rule === 'addon') return this.isAddonMode();
        if (rule === 'dev')   return this.isDevEnv();
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
    },

    /** True if the given page route should be visible in the current env. */
    isPageEnabled(page) {
        const key = this.PAGE_FEATURE[page];
        return key ? this.shouldShow(key) : true;
    },
};
