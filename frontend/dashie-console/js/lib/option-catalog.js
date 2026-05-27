/* ============================================================
   OptionCatalog — central source of truth for dropdown option lists.

   Why this exists:
     The Console rendered many device settings as dropdowns, but the
     option lists were inline-hardcoded inside devices-detail.js. Most
     of those lists were guesses that didn't match the real values the
     dashboard accepts — e.g. theme family options listed
     "default/midnight/ocean/forest" but the real registry only has
     "default/halloween/christmas/blue". Saving "midnight" silently
     fell back to the default theme.

   Pattern:
     Every dropdown in devices-detail.js sources its options from one
     of the helpers below. Never inline a fresh option array in a
     settings page — add it here instead. Each helper documents where
     its values come from so future updates can be cross-checked.

   Tooling note:
     Long-term we want a Supabase edge function that introspects the
     authoritative registries (theme-registry.js, the personality
     service, ElevenLabs catalog) and serves a single live catalog —
     see _TECHNICAL_DEBT.md "Web Subscribe Flow Pieces 2 & 3 — Smaller
     related follow-ups". For now these are static lists that mirror
     the dashboard source and need manual updates when registries
     change.

   If you can't find an authoritative source for a list, do NOT add
   it here. Render the setting as a read-only chip in devices-detail
   instead so we don't ship a misleading dropdown.
   ============================================================ */

const OptionCatalog = {
    /** True/false toggles. Universal. */
    onOff() {
        return [['true', 'On'], ['false', 'Off']];
    },

    /**
     * Theme families.
     * Source: dashieapp_staging/js/ui/themes/theme-registry.js → THEME_FAMILIES
     * Last synced: 2026-05-27
     * Note: themeMode (light/dark) is a separate setting — see themeModes().
     */
    themeFamilies() {
        return [
            ['default',   'Default'],
            ['halloween', 'Halloween'],
            ['christmas', 'Christmas'],
            ['blue',      'Blue'],
        ];
    },

    /**
     * Theme mode.
     * Source: dashieapp_staging/js/ui/themes/theme-registry.js → each family
     * exposes variants.{light, dark}. There's no 'system' mode.
     * Last synced: 2026-05-27
     */
    themeModes() {
        return [
            ['light', 'Light'],
            ['dark',  'Dark'],
        ];
    },

    /**
     * Layout modes.
     * Source: dashieapp_staging/js/modules/layout/layout-service.js:279
     *   `mode === 'widgets' || mode === 'single_panel' || mode === 'canvas'`
     * NOTE: 'single_panel' uses an underscore, not a hyphen.
     * Last synced: 2026-05-27
     */
    layoutModes() {
        return [
            ['widgets',      'Widgets'],
            ['single_panel', 'Single Panel'],
            ['canvas',       'Canvas'],
        ];
    },

    /**
     * Animation level.
     * Source: dashieapp_staging/js/modules/Settings/pages/settings-display-page.js:193
     *   Display chip: `animationLevel === 'high' ? 'High' : 'Low'`
     * Last synced: 2026-05-27
     */
    animationLevels() {
        return [
            ['high', 'High'],
            ['low',  'Low'],
        ];
    },

    /**
     * Sleep method.
     * Source: dashieapp_staging/js/services/sleep-timer-service.js:75
     *   `if (method === 'inactivity') { ... } else { ... schedule path ... }`
     * Default = 'schedule'.
     * Last synced: 2026-05-27
     */
    sleepMethods() {
        return [
            ['schedule',   'Schedule (time-based)'],
            ['inactivity', 'Inactivity (idle timeout)'],
        ];
    },

    /**
     * Common sleep / wake time options. These aren't a real enum — the
     * dashboard accepts any HH:MM string — but a dropdown of common
     * times is friendlier than a raw time input for the Console use
     * case. User who wants 3:17 AM should edit on the dashboard.
     */
    sleepTimes() {
        return [
            ['20:00', '8:00 PM'], ['20:30', '8:30 PM'],
            ['21:00', '9:00 PM'], ['21:30', '9:30 PM'],
            ['22:00', '10:00 PM'], ['22:30', '10:30 PM'],
            ['23:00', '11:00 PM'], ['23:30', '11:30 PM'],
            ['00:00', '12:00 AM'],
        ];
    },
    wakeTimes() {
        return [
            ['05:00', '5:00 AM'], ['05:30', '5:30 AM'],
            ['06:00', '6:00 AM'], ['06:30', '6:30 AM'],
            ['07:00', '7:00 AM'], ['07:30', '7:30 AM'],
            ['08:00', '8:00 AM'], ['08:30', '8:30 AM'],
            ['09:00', '9:00 AM'],
        ];
    },

    /**
     * Re-sleep delay (minutes) and inactivity timeout (seconds). Free
     * numeric ranges — sample values for dropdown convenience.
     */
    resleepDelays() {
        return [['5', '5'], ['10', '10'], ['15', '15'], ['30', '30'], ['60', '60']];
    },
    inactivityTimeouts() {
        return [['30', '30'], ['60', '60'], ['120', '120'], ['300', '300'], ['600', '600']];
    },
};
