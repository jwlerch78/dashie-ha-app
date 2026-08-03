/* ============================================================
   Brand — single source of truth for product identity
   ============================================================
   Every user-visible brand string, brand asset path, and docs URL lives
   here, so an edition swaps this one file. Loaded before all other console
   scripts.

   One brand since 2026-07-30 (Chickadee retired): this file and the published
   build's brand.js now differ in `build` and little else. What the file still
   carries is the EDITION flag the feature gate reads.

   What does NOT belong here — identifiers and wire values, where renaming
   breaks persisted state or a cross-boundary contract:
     - `dashie_cloud` engine ID (stable wire value; only its display LABEL
       is brand — use BRAND.cloudName for that)
     - localStorage/sessionStorage keys (dashie-user-data,
       dashie-post-login-next, …) — rename = silent logout
     - CSS class names (dashie-login-*, dashie-path-*, …) and JS globals
       (DashieAuth, DASHIE_CONSOLE_VERSION)
     - option/personality/wake-word IDs ('hey_dashie', 'dashie')
   ============================================================ */

const BRAND = {
    // EDITION, not brand. 'full' = the published core PLUS the closed family
    // delta (calendar, chores, family, photos, devices, …); 'published' = the
    // core alone, as shipped in the Dashie for Home Assistant add-on.
    //
    // Stated EXPLICITLY since 2026-07-30. It used to be absent here, so
    // FeatureGate's "missing → not the published build" resolved to full-build
    // behaviour — i.e. the gate that hides the family pages failed OPEN, and a
    // half-generated brand.js was indistinguishable from a deliberate full
    // build. FeatureGate now treats anything but these two values as
    // 'published' and logs a DROP; leaving this field out is a defect.
    // Registered in .reference/JS_KOTLIN_CONTRACTS.md.
    build: 'full',

    // Product + assistant naming
    productName: 'Dashie',           // the product/account ("Your Dashie account")
    consoleName: 'Dashie Console',   // tab title + login heading
    assistantName: 'Dashie',         // the voice persona ("Dashie said …", "Ask Dashie")
    wakePhrase: 'Hey Dashie',        // display only — wake-word IDs stay 'hey_dashie'
    cloudName: 'Dashie Cloud',       // display label for the `dashie_cloud` engine + hosted service
    teamName: 'the Dashie team',     // "reviewed by the Dashie team"

    // Web presence
    domain: 'dashieapp.com',
    supportEmail: 'support@dashieapp.com',

    // Brand assets (paths relative to the console root)
    logo: 'assets/dashie-logo-orange.png',   // full wordmark
    icon: 'assets/dashie-icon.png',          // square icon / favicon

    // Docs / legal
    urls: {
        privacy: 'https://dashieapp.com/privacy-policy.html',
        terms: 'https://dashieapp.com/terms-of-service.html',
    },
};

// Keep the tab title brand-driven (index.html ships a static fallback).
try { document.title = BRAND.consoleName; } catch (_) { /* non-browser */ }

window.BRAND = BRAND;
