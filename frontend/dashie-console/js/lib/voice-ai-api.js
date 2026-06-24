/* ============================================================
   Voice & AI API — account-global AI defaults + personality
   catalog, both reachable with the console's existing JWT.

   Two backends, no new edge functions:
   - Account AI defaults live in the user_settings blob (nested
     ai.* / voice.*), read/written via DashieAuth.loadUserSettings
     / saveUserSettings (the jwt-auth load/save path). Writes are
     full-blob read-modify-write — load, merge, save — so we never
     clobber other settings categories.
   - Personalities (templates + custom) + voices come from
     database-operations via DashieAuth.dbRequest.

   None of this touches HA, so the page works in both cloud and
   add-on mode (gated alpha-only, same as the rest of voice/AI).
   ============================================================ */

const VoiceAiApi = {
    /** The account-global keys this surface owns, by user_settings path.
     *  Kept explicit so a save only ever touches these — everything else
     *  in the blob is preserved verbatim. */
    AI_DEFAULT_KEYS: [
        ['ai', 'model'],
        ['voice', 'controlMethod'],
        ['voice', 'customizePipeline'],
        ['voice', 'sttProvider'],
        ['voice', 'ttsProvider'],
        ['ai', 'webSearchEnabled'],
        ['ai', 'retrievePicturesEnabled'],
        ['ai', 'conversationContextEnabled'],
        ['ai', 'conversationTimeout'],
        ['ai', 'retainTranscripts'],
        ['voice', 'alwaysUseAI'],
        ['voice', 'searchSource'],
        ['voice', 'sportsSource'],
        ['voice', 'localLlmUrl'],
        ['voice', 'localLlmModel'],
        ['voice', 'searxngUrl'],
        ['voice', 'localTtsUrl'],
        ['voice', 'localSttUrl'],
    ],

    DEFAULTS: {
        'ai.model': 'gemini-2.5-flash',
        'voice.controlMethod': 'dashie_cloud',
        'voice.customizePipeline': false,
        'voice.sttProvider': 'dashie_cloud',
        'voice.ttsProvider': 'dashie_cloud',
        'ai.webSearchEnabled': true,
        'ai.retrievePicturesEnabled': false,
        'ai.conversationContextEnabled': false,
        'ai.conversationTimeout': 30,
        'ai.retainTranscripts': false,
        'voice.alwaysUseAI': false,
        'voice.searchSource': 'dashie',
        'voice.sportsSource': 'espn',
        'voice.localLlmUrl': '',
        'voice.localLlmModel': '',
        'voice.searxngUrl': '',
        'voice.localTtsUrl': '',
        'voice.localSttUrl': '',
    },

    /** Legacy → engine-domain value remap. Accounts the console wrote before the
     *  engine-model alignment hold vendor values (deepgram/elevenlabs/dashie/native)
     *  that no longer match the option ids; normalize on load so the dropdowns render
     *  the right selection. Display-only — the normalized value isn't persisted until
     *  the user next saves (honors the no-migration decision). */
    _LEGACY_MAP: {
        'voice.controlMethod': { dashie: 'dashie_cloud', ha: 'voice_assistant' },
        'voice.sttProvider':   { deepgram: 'dashie_cloud', whisper: 'dashie_cloud', native: 'android_voice' },
        'voice.ttsProvider':   { elevenlabs: 'dashie_cloud', openai: 'dashie_cloud', native: 'android_voice' },
    },

    /** Load the account AI defaults as a flat {dotted: value} object,
     *  filling defaults for anything unset and normalizing legacy values. */
    async loadAiDefaults() {
        const settings = await DashieAuth.loadUserSettings();
        const out = {};
        for (const [a, b] of this.AI_DEFAULT_KEYS) {
            const key = `${a}.${b}`;
            const v = settings?.[a]?.[b];
            let val = v === undefined ? this.DEFAULTS[key] : v;
            const lmap = this._LEGACY_MAP[key];
            if (lmap && lmap[val] !== undefined) val = lmap[val];
            out[key] = val;
        }
        return out;
    },

    /** Merge a single account AI default into the full user_settings blob
     *  and persist. dottedKey e.g. 'ai.model'. Read-modify-write of the
     *  whole blob — mirrors how chores.js persists user_settings. */
    async saveAiDefault(dottedKey, value) {
        const [a, b] = dottedKey.split('.');
        const settings = await DashieAuth.loadUserSettings();
        settings[a] = { ...(settings[a] || {}), [b]: value };
        await DashieAuth.saveUserSettings(settings);
        return value;
    },

    // ── Personalities ────────────────────────────────────────

    /** Built-in template catalog (read-only, admin-managed). Returns the
     *  raw rows from list_personality_templates. */
    async listTemplates() {
        const res = await DashieAuth.dbRequest('list_personality_templates');
        return res.data || [];
    },

    /** Custom (user-owned) personalities. */
    async listCustom() {
        const res = await DashieAuth.dbRequest('list_personalities');
        return res.data || [];
    },

    async createPersonality(p) {
        const res = await DashieAuth.dbRequest('create_personality', this._personalityPayload(p));
        return res.data;
    },

    async updatePersonality(id, p) {
        const res = await DashieAuth.dbRequest('update_personality', { id, ...this._personalityPayload(p) });
        return res.data;
    },

    async deletePersonality(id) {
        return DashieAuth.dbRequest('delete_personality', { id });
    },

    /** Family-notes override on a built-in template. */
    async saveOverride(templateKey, familyNotes) {
        const res = await DashieAuth.dbRequest('save_personality_override', {
            template_key: templateKey,
            family_notes: familyNotes,
        });
        return res.data;
    },

    async listOverrides() {
        const res = await DashieAuth.dbRequest('list_personality_overrides');
        return res.data || [];
    },

    /** TTS voice catalog (key, name, gender, description). */
    async listVoices() {
        const res = await DashieAuth.dbRequest('list_voices');
        return res.data || [];
    },

    /** Normalize an editor draft to the create/update handler shape. */
    _personalityPayload(p) {
        return {
            name: p.name,
            base_personality: p.base_personality || null,
            personality_overview: p.personality_overview || null,
            similar_persona: p.similar_persona || null,
            adjectives: p.adjectives && p.adjectives.length ? p.adjectives : null,
            topics: p.topics && p.topics.length ? p.topics : null,
            example_phrases: p.example_phrases && p.example_phrases.length ? p.example_phrases : null,
            family_notes: p.family_notes || null,
            voice_mode: p.voice_mode || 'preferred',
            voice: p.voice || null,
        };
    },
};
