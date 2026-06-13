/* ============================================================
   ConsoleAiClient — same pipeline the tablets run, in the Console.
   ------------------------------------------------------------
   Mirrors the webapp's
       _buildPrompt → ai-gateway → ai-response-parser →
       info_request fetch → _buildPrompt(inquiry) → ai-gateway →
       execute_commands → haService.callService()
   flow as closely as possible. Uses the actual webapp prompt
   templates (vendored in ai-prompt-templates.js) and the actual
   personality wrapper (personality-prompt-builder.js).

   Two-pass for HA:
     1. Initial prompt = base-context + response-format-initial + personality.
     2. AI replies — usually info_request { tool: 'home_assistant',
        query: { command_hint } } for any smart-home command.
     3. We fetch the user's controllable HA entities via the add-on
        (/api/ha/entities), exactly the shape the webapp builds via
        haService.discoverEntities() + the controllableDomains filter.
     4. Second prompt = inquiries/home-assistant.md filled with the
        entity list + personality. AI returns `execute_commands`.
     5. We dispatch each command via the add-on (/api/ha/service),
        same shape haService.callService(domain, service, data) sends.

   Public API:
     await ConsoleAiClient.sendQuery(text, {
        personalityId, modelId, history,
        onStage(stageName, detail)   // optional progress callback
     }) → turn object (see end of file for shape)
   ============================================================ */

const ConsoleAiClient = {
    _personalityCache: new Map(),
    _entityCache: null,
    _entityCacheAt: 0,
    _ENTITY_CACHE_MS: 60_000,

    /** Look up the provider for a model from the bundled catalog. The catalog
     *  is the source of truth used by web + Android + here; prefix-sniffing
     *  the id breaks on shapes like 'us.amazon.nova-2-lite-v1:0' (was falling
     *  through to 'claude' default, which is why a Nova selection got routed
     *  to Anthropic and 400'd on the Claude API). Falls back to prefix-sniff
     *  only if the catalog isn't loaded yet. */
    _providerForModel(modelId) {
        if (!modelId || typeof modelId !== 'string') return 'claude';
        const row = window.AiModelCatalog?.AI_MODEL_CATALOG?.find(m => m.id === modelId);
        if (row?.provider) return row.provider;
        const id = modelId.toLowerCase();
        if (id.startsWith('claude-')) return 'claude';
        if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3')) return 'openai';
        if (id.startsWith('gemini-')) return 'gemini';
        if (id.startsWith('us.amazon.') || id.startsWith('bedrock-') || id.includes('nova')) return 'bedrock';
        return 'claude';
    },

    /** Per-provider max_tokens — matches webapp ai-context.js AI_CONFIG.
     *  Gemini gets a much larger budget because search-result synthesis
     *  often blows past 1500 tokens; truncation mid-JSON makes the parser
     *  fail and the chat ends up rendering literal half-finished JSON. */
    _maxTokensForProvider(provider) {
        switch (provider) {
            case 'claude':  return 1500;
            case 'openai':  return 1500;
            case 'gemini':  return 50000;
            case 'bedrock': return 5000;
            default:        return 2048;
        }
    },

    async _getPersonality(personalityId) {
        if (!personalityId) return null;
        if (this._personalityCache.has(personalityId)) {
            return this._personalityCache.get(personalityId);
        }
        let row = null;
        try {
            const result = await DashieAuth.dbRequest('get_personality', { id: personalityId });
            row = result?.data || result?.personality || null;
        } catch (e) { /* try by key */ }
        if (!row) {
            try {
                const result = await DashieAuth.dbRequest('get_personality', { key: personalityId });
                row = result?.data || result?.personality || null;
            } catch (e) { /* leave null */ }
        }
        this._personalityCache.set(personalityId, row);
        return row;
    },

    /** Per-token cost estimation. Pricing sourced from
     *  window.AiModelCatalog.pricingFor(modelId), which the bundler emits
     *  from config.js's TOKEN_COSTS. Single source of truth across web,
     *  Android picker, and this test harness. */
    estimateCost(modelId, inputTokens, outputTokens) {
        const rates = window.AiModelCatalog?.pricingFor?.(modelId);
        if (!rates) return { input: 0, output: 0, total: 0, known: false };
        const input  = (inputTokens  || 0) * rates[0] / 1_000_000;
        const output = (outputTokens || 0) * rates[1] / 1_000_000;
        return { input, output, total: input + output, known: true };
    },

    /** Fetch + cache the controllable HA entity list from the add-on.
     *  Cache TTL matches the webapp's haService entity cache window. */
    async _getControllableEntities() {
        const now = Date.now();
        if (this._entityCache && (now - this._entityCacheAt) < this._ENTITY_CACHE_MS) {
            return this._entityCache;
        }
        const resp = await fetch(DashieAuth._addonUrl('/api/ha/entities'));
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            throw new Error(body.message || body.error || `HTTP ${resp.status}`);
        }
        const body = await resp.json();
        this._entityCache = body;
        this._entityCacheAt = now;
        return body;
    },

    /** Call the same web-search-gateway edge fn the webapp uses. Returns the
     *  raw provider response (results array + provider name + metadata). */
    async _runWebSearch(query, { provider = 'brave', count = 10 } = {}) {
        const url = `${DashieAuth.config.url}/functions/v1/web-search-gateway`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': DashieAuth.anonKey,
                'Authorization': `Bearer ${DashieAuth.anonKey}`,
            },
            body: JSON.stringify({ provider, query, options: { count } }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || body.message || `HTTP ${resp.status}`);
        return body;
    },

    /** Format search results as the AI sees them — mirrors the webapp's
     *  webSearchService.formatResultsForAI() output. */
    _formatSearchResultsForPrompt(searchResponse, maxResults = 5) {
        const results = (searchResponse?.results || []).slice(0, maxResults);
        let formatted = `Web Search Results (via ${searchResponse?.provider || 'unknown'}):\n\n`;
        results.forEach((r, i) => {
            formatted += `${i + 1}. ${r.title || ''}\n`;
            formatted += `   URL: ${r.url || ''}\n`;
            formatted += `   ${r.snippet || ''}\n\n`;
        });
        if ((searchResponse?.results || []).length > maxResults) {
            formatted += `... and ${searchResponse.results.length - maxResults} more results\n`;
        }
        return formatted;
    },

    /** Build the initial prompt — base context filled with date/time/user
     *  request, prepended with personality prefix, appended with the slim
     *  response-format-initial spec, then personality suffix. Matches the
     *  webapp's buildPrompt() with inquiryType=null. */
    _buildInitialPrompt({ userRequest, personalityWrap, history }) {
        const T = window.AiPromptTemplates;
        const baseValues = {
            DATE_TIME: T.formatDateTime(),
            USER_REQUEST: userRequest,
            CHAT_HISTORY: this._formatHistory(history),
            AVAILABLE_TOOLS_LIST: T.AVAILABLE_TOOLS_LIST,
        };
        let prompt = T.fillTemplate(T.BASE_CONTEXT, baseValues);
        if (personalityWrap.responsePrefix) {
            prompt = personalityWrap.responsePrefix + '\n\n' + prompt;
        }
        prompt += '\n\n' + T.fillTemplate(T.RESPONSE_FORMAT_INITIAL, baseValues);
        if (personalityWrap.responseSuffix) {
            prompt += personalityWrap.responseSuffix;
        }
        return prompt;
    },

    /** Second-pass HA prompt — inquiries/home-assistant.md filled with the
     *  user's entity list. Matches buildPrompt({inquiryType: 'home-assistant',
     *  retrievedData: {entities, entities_by_domain, command_hint}}). */
    _buildHomeAssistantPrompt({ userRequest, personalityWrap, retrievedData }) {
        const T = window.AiPromptTemplates;
        const baseValues = {
            DATE_TIME: T.formatDateTime(),
            USER_REQUEST: userRequest,
            HA_ENTITIES: JSON.stringify(retrievedData.entities || [], null, 2),
            HA_ENTITIES_BY_DOMAIN: JSON.stringify(retrievedData.entities_by_domain || {}, null, 2),
            COMMAND_HINT: retrievedData.command_hint || userRequest,
        };
        let prompt = T.fillTemplate(T.INQUIRY_HOME_ASSISTANT, baseValues);
        // Webapp parity: prompt-builder.js appends response-format.md after
        // every inquiry template when retrievedData is present, even when
        // the inquiry has its own format guidance. Keep the pattern uniform.
        prompt += '\n\n' + T.fillTemplate(T.RESPONSE_FORMAT_FULL, baseValues);
        if (personalityWrap.responsePrefix) {
            prompt = personalityWrap.responsePrefix + '\n\n' + prompt;
        }
        if (personalityWrap.responseSuffix) {
            prompt += personalityWrap.responseSuffix;
        }
        return prompt;
    },

    /** Second-pass web-search prompt — inquiries/web-search.md + the full
     *  response-format spec, wrapped in personality. The webapp's
     *  prompt-builder.js appends response-format.md after every inquiry
     *  template; without it the model returns prose markdown instead of
     *  the structured JSON our parser needs. */
    _buildWebSearchPrompt({ userRequest, personalityWrap, retrievedData }) {
        const T = window.AiPromptTemplates;
        const baseValues = {
            DATE_TIME: T.formatDateTime(),
            USER_REQUEST: userRequest,
            SEARCH_RESULTS: retrievedData.formatted || JSON.stringify(retrievedData, null, 2),
        };
        let prompt = T.fillTemplate(T.INQUIRY_WEB_SEARCH, baseValues);
        prompt += '\n\n' + T.fillTemplate(T.RESPONSE_FORMAT_FULL, baseValues);
        if (personalityWrap.responsePrefix) prompt = personalityWrap.responsePrefix + '\n\n' + prompt;
        if (personalityWrap.responseSuffix) prompt += personalityWrap.responseSuffix;
        return prompt;
    },

    _formatHistory(history) {
        if (!Array.isArray(history) || history.length === 0) return '';
        const lines = history.slice(-4).map(h => {
            const speaker = h.role === 'user' ? 'User' : 'You';
            return `${speaker}: ${h.content || ''}`;
        });
        return `Recent conversation:\n${lines.join('\n')}\n`;
    },

    _parseContent(content) {
        if (!content || typeof content !== 'string') return null;
        let body = content.trim();
        body = body.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        const firstBrace = body.indexOf('{');
        if (firstBrace > 0) body = body.slice(firstBrace);

        // Try as-is first.
        try { return JSON.parse(body); } catch (_) { /* fall through */ }

        // Strip trailing commas before } or ]. Common Gemini quirk.
        const cleaned = body.replace(/,(\s*[}\]])/g, '$1');
        try { return JSON.parse(cleaned); } catch (_) { /* fall through */ }

        // Truncated response repair: trim to the last balanced brace.
        // Walks the string tracking quote/brace state and remembers the
        // last index where outer depth returned to 0 — that's the largest
        // valid JSON prefix. Then close any still-open braces.
        const repaired = this._repairTruncatedJson(cleaned);
        if (repaired) {
            try { return JSON.parse(repaired); } catch (_) { /* fall through */ }
        }

        return null;
    },

    /** Best-effort recovery of a JSON object whose tail was cut off by
     *  max_tokens. We track brace/bracket depth, ignore characters inside
     *  string literals, and remember the longest prefix that ends inside
     *  a value position with balanced quotes. Then we close every still-
     *  open scope. Not perfect (won't recover an unfinished string field),
     *  but salvages the common case where truncation lands between fields. */
    _repairTruncatedJson(s) {
        if (!s || s[0] !== '{') return null;
        let inString = false;
        let escape = false;
        const stack = [];
        let validEnd = -1;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (escape) { escape = false; continue; }
            if (inString) {
                if (ch === '\\') escape = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') { inString = true; continue; }
            if (ch === '{' || ch === '[') stack.push(ch);
            else if (ch === '}' || ch === ']') stack.pop();
            // Mark valid end after a value-terminating char with empty stack
            // — anything past this is mid-field and unparseable.
            if (stack.length > 0 && (ch === ',' || ch === '}' || ch === ']')) validEnd = i;
        }
        if (inString) return null;          // truncated inside a string — give up
        if (stack.length === 0) return s;   // already balanced; outer parse already failed for another reason
        // Trim trailing comma if any (we may have stopped after one).
        let prefix = s;
        if (validEnd !== -1 && validEnd < s.length - 1) prefix = s.slice(0, validEnd + 1);
        prefix = prefix.replace(/,(\s*)$/, '$1');
        // Close all open scopes.
        const closers = stack.map(c => (c === '{' ? '}' : ']')).reverse().join('');
        return prefix + closers;
    },

    /** POST the prompt to ai-gateway and return { ok, raw, latency_ms, error }. */
    async _callGateway({ provider, prompt, modelId }) {
        const t0 = performance.now();
        try {
            const resp = await fetch(`${DashieAuth.config.url}/functions/v1/ai-gateway`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': DashieAuth.anonKey,
                    'Authorization': `Bearer ${DashieAuth.anonKey}`,
                },
                body: JSON.stringify({
                    provider,
                    prompt,
                    stream: false,
                    options: {
                        model: modelId,
                        max_tokens: this._maxTokensForProvider(provider),
                        temperature: 0.7,
                    },
                }),
            });
            const body = await resp.json().catch(() => ({}));
            const latency_ms = Math.round(performance.now() - t0);
            if (!resp.ok) {
                return { ok: false, error: body.error || body.message || `HTTP ${resp.status}`, latency_ms };
            }
            return { ok: true, raw: body, latency_ms };
        } catch (e) {
            return { ok: false, error: e?.message || String(e), latency_ms: Math.round(performance.now() - t0) };
        }
    },

    /** Fire an HA service call via the add-on. */
    async _callHaService(domain, service, data) {
        try {
            const resp = await fetch(DashieAuth._addonUrl('/api/ha/service'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain, service, data: data || {} }),
            });
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok || body.success === false) {
                return { ok: false, error: body.error || body.message || `HTTP ${resp.status}` };
            }
            return { ok: true, result: body.result };
        } catch (e) {
            return { ok: false, error: e?.message || String(e) };
        }
    },

    async _dispatchExecuteCommands(commands) {
        const results = [];
        for (const c of commands) {
            const r = await this._callHaService(c.domain, c.service, c.data);
            results.push({
                domain: c.domain, service: c.service, data: c.data || {},
                ok: r.ok, error: r.error || null,
            });
        }
        return results;
    },

    /** forward_to_assist — POST text to HA Assist via the add-on. */
    async _dispatchForwardToAssist(transcript) {
        try {
            const resp = await fetch(DashieAuth._addonUrl('/api/ha/conversation'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: transcript || '' }),
            });
            const body = await resp.json().catch(() => ({}));
            return {
                ok: resp.ok && body.success !== false,
                response: body.response || body,
                error: !resp.ok ? (body.message || body.error || `HTTP ${resp.status}`) : null,
            };
        } catch (e) {
            return { ok: false, error: e?.message || String(e) };
        }
    },

    /** Main entry point. Returns a structured "turn" object. */
    async sendQuery(text, opts = {}) {
        const t0 = performance.now();
        const personalityId = opts.personalityId || null;
        const modelId = opts.modelId || window.AiModelCatalog?.DEFAULT_AI_MODEL || 'gemini-3.1-flash-lite';
        const history = Array.isArray(opts.history) ? opts.history : [];
        const onStage = typeof opts.onStage === 'function' ? opts.onStage : () => {};

        // ── NLP FAST PATH ──────────────────────────────────────────
        // Mirror the tablet's IntentClassifier behavior: clear HA
        // commands skip the AI entirely and forward straight to HA's
        // Assist pipeline. Same effect, way smaller code surface than
        // porting the full 4k-line webapp classifier.
        if (window.ConsoleIntentClassifier) {
            const cls = window.ConsoleIntentClassifier.classify(text);
            if (cls.matched && cls.intent?.command === 'forward_to_assist') {
                onStage('nlp_intercept', { confidence: cls.confidence });
                const tAct0 = performance.now();
                const assist = await this._dispatchForwardToAssist(cls.intent.transcript);
                const actLatency = Math.round(performance.now() - tAct0);
                const speech = assist?.response?.response?.speech?.plain?.speech || '';
                const responseType = assist?.response?.response?.response_type || (assist.ok ? 'action_done' : 'error');
                return {
                    ok: true,
                    type: 'action',
                    voice: speech || (assist.ok ? 'Done.' : "Sorry, that didn't work."),
                    text: null,
                    action: {
                        category: 'homeassistant',
                        command: 'forward_to_assist',
                        parameters: { transcript: cls.intent.transcript },
                    },
                    action_result: {
                        dispatched: assist.ok,
                        kind: 'forward_to_assist',
                        response: assist.response,
                        response_type: responseType,
                        error: assist.error || null,
                    },
                    action_latency_ms: actLatency,
                    parsed_ok: true,
                    raw_content: null,
                    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
                    model: 'nlp',
                    provider: 'local',
                    latency_ms: actLatency,
                    nlp_confidence: cls.confidence,
                    stages: [{ name: 'nlp_intercept', latency_ms: actLatency, confidence: cls.confidence }],
                    total_latency_ms: Math.round(performance.now() - t0),
                };
            }
        }

        const provider = this._providerForModel(modelId);
        const personality = await this._getPersonality(personalityId);
        const personalityWrap = (window.PersonalityPromptBuilder
            ? window.PersonalityPromptBuilder.buildPersonalityPrompt(personality)
            : { responsePrefix: '', responseSuffix: '' });

        onStage('pass1_start', { provider, modelId });

        // ── PASS 1 ─────────────────────────────────────────────────
        const initialPrompt = this._buildInitialPrompt({ userRequest: text, personalityWrap, history });
        const pass1 = await this._callGateway({ provider, prompt: initialPrompt, modelId });

        if (!pass1.ok) {
            return {
                ok: false, error: pass1.error,
                latency_ms: pass1.latency_ms,
                total_latency_ms: Math.round(performance.now() - t0),
                stages: [{ name: 'pass1', latency_ms: pass1.latency_ms, error: pass1.error }],
            };
        }

        const pass1Parsed = this._parseContent(pass1.raw.content);
        const pass1Stage = {
            name: 'pass1',
            latency_ms: pass1.latency_ms,
            model: pass1.raw.model,
            provider: pass1.raw.provider,
            usage: pass1.raw.usage,
            type: pass1Parsed?.type || 'response',
            parsed: pass1Parsed,
            raw_content: pass1.raw.content,
        };
        onStage('pass1_done', pass1Stage);

        // ── If it's a direct response or non-HA action, we're done.
        if (!pass1Parsed || pass1Parsed.type === 'response' || pass1Parsed.type === 'action') {
            return await this._finalize({
                t0, parsed: pass1Parsed, raw: pass1.raw,
                stages: [pass1Stage],
                primary_model: pass1.raw.model, primary_provider: pass1.raw.provider,
                primary_usage: pass1.raw.usage, primary_latency: pass1.latency_ms,
            });
        }

        // ── info_request → web_search ──────────────────────────────
        if (pass1Parsed.type === 'info_request' && pass1Parsed.tool === 'web_search') {
            const queryStr = typeof pass1Parsed.query === 'string'
                ? pass1Parsed.query
                : (pass1Parsed.query?.query || pass1Parsed.query?.q || text);
            onStage('fetch_search_start', { query: queryStr });
            const tFetch0 = performance.now();
            let searchResp;
            try {
                searchResp = await this._runWebSearch(queryStr);
            } catch (e) {
                const fetchErr = e?.message || String(e);
                return {
                    ok: false, error: `Web search failed: ${fetchErr}`,
                    latency_ms: pass1.latency_ms,
                    total_latency_ms: Math.round(performance.now() - t0),
                    stages: [pass1Stage, { name: 'fetch_search', latency_ms: Math.round(performance.now() - tFetch0), error: fetchErr }],
                };
            }
            const fetchStage = {
                name: 'fetch_search',
                latency_ms: Math.round(performance.now() - tFetch0),
                result_count: searchResp?.results?.length || 0,
                provider: searchResp?.provider || 'unknown',
            };
            onStage('fetch_search_done', fetchStage);

            // Pass 2
            const formatted = this._formatSearchResultsForPrompt(searchResp);
            const wsPrompt = this._buildWebSearchPrompt({
                userRequest: text, personalityWrap,
                retrievedData: { formatted },
            });
            onStage('pass2_start', {});
            const pass2 = await this._callGateway({ provider, prompt: wsPrompt, modelId });
            if (!pass2.ok) {
                return {
                    ok: false, error: pass2.error,
                    latency_ms: pass2.latency_ms,
                    total_latency_ms: Math.round(performance.now() - t0),
                    stages: [pass1Stage, fetchStage, { name: 'pass2', latency_ms: pass2.latency_ms, error: pass2.error }],
                };
            }
            const pass2Parsed = this._parseContent(pass2.raw.content);
            const pass2Stage = {
                name: 'pass2',
                latency_ms: pass2.latency_ms,
                model: pass2.raw.model, provider: pass2.raw.provider,
                usage: pass2.raw.usage,
                type: pass2Parsed?.type || 'response',
                parsed: pass2Parsed, raw_content: pass2.raw.content,
            };
            onStage('pass2_done', pass2Stage);
            const totalUsage = this._sumUsage([pass1.raw.usage, pass2.raw.usage]);
            return await this._finalize({
                t0, parsed: pass2Parsed, raw: pass2.raw,
                stages: [pass1Stage, fetchStage, pass2Stage],
                primary_model: pass2.raw.model, primary_provider: pass2.raw.provider,
                primary_usage: totalUsage,
                primary_latency: pass1.latency_ms + pass2.latency_ms,
            });
        }

        // ── info_request → other (unsupported) tool ────────────────
        if (pass1Parsed.type !== 'info_request' || pass1Parsed.tool !== 'home_assistant') {
            return await this._finalize({
                t0, parsed: pass1Parsed, raw: pass1.raw,
                stages: [pass1Stage],
                primary_model: pass1.raw.model, primary_provider: pass1.raw.provider,
                primary_usage: pass1.raw.usage, primary_latency: pass1.latency_ms,
                unsupported_tool: pass1Parsed.tool,
            });
        }

        // ── FETCH HA ENTITIES ──────────────────────────────────────
        onStage('fetch_entities_start', {});
        const tFetch0 = performance.now();
        let retrievedData;
        try {
            retrievedData = await this._getControllableEntities();
        } catch (e) {
            const fetchErr = e?.message || String(e);
            return {
                ok: false, error: `HA entity fetch failed: ${fetchErr}`,
                latency_ms: pass1.latency_ms,
                total_latency_ms: Math.round(performance.now() - t0),
                stages: [
                    pass1Stage,
                    { name: 'fetch_entities', latency_ms: Math.round(performance.now() - tFetch0), error: fetchErr },
                ],
            };
        }
        const fetchStage = {
            name: 'fetch_entities',
            latency_ms: Math.round(performance.now() - tFetch0),
            entity_count: retrievedData?.entities?.length || 0,
        };
        onStage('fetch_entities_done', fetchStage);

        // ── PASS 2 ─────────────────────────────────────────────────
        const commandHint = pass1Parsed.query?.command_hint || text;
        const haPrompt = this._buildHomeAssistantPrompt({
            userRequest: text, personalityWrap,
            retrievedData: { ...retrievedData, command_hint: commandHint },
        });
        onStage('pass2_start', {});
        const pass2 = await this._callGateway({ provider, prompt: haPrompt, modelId });
        if (!pass2.ok) {
            return {
                ok: false, error: pass2.error,
                latency_ms: pass2.latency_ms,
                total_latency_ms: Math.round(performance.now() - t0),
                stages: [pass1Stage, fetchStage, { name: 'pass2', latency_ms: pass2.latency_ms, error: pass2.error }],
            };
        }
        const pass2Parsed = this._parseContent(pass2.raw.content);
        const pass2Stage = {
            name: 'pass2',
            latency_ms: pass2.latency_ms,
            model: pass2.raw.model, provider: pass2.raw.provider,
            usage: pass2.raw.usage,
            type: pass2Parsed?.type || 'response',
            parsed: pass2Parsed, raw_content: pass2.raw.content,
        };
        onStage('pass2_done', pass2Stage);

        // Sum usage across passes.
        const totalUsage = this._sumUsage([pass1.raw.usage, pass2.raw.usage]);
        return await this._finalize({
            t0, parsed: pass2Parsed, raw: pass2.raw,
            stages: [pass1Stage, fetchStage, pass2Stage],
            primary_model: pass2.raw.model, primary_provider: pass2.raw.provider,
            primary_usage: totalUsage,
            primary_latency: pass1.latency_ms + pass2.latency_ms,
        });
    },

    _sumUsage(usages) {
        const total = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
        for (const u of usages) {
            if (!u) continue;
            total.input_tokens  += u.input_tokens  || 0;
            total.output_tokens += u.output_tokens || 0;
            total.total_tokens  += u.total_tokens  || 0;
        }
        return total;
    },

    /** Build the final turn object. Dispatch any action present. */
    async _finalize({ t0, parsed, raw, stages, primary_model, primary_provider, primary_usage, primary_latency, unsupported_tool }) {
        const out = {
            ok: true,
            type: parsed?.type || 'response',
            voice: parsed?.voice || raw.content || '',
            text: parsed?.text || null,
            action: parsed?.action || null,
            parsed_ok: !!parsed,
            raw_content: raw.content,
            usage: primary_usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
            model: primary_model,
            provider: primary_provider,
            latency_ms: primary_latency,
            stages,
            unsupported_tool: unsupported_tool || null,
        };
        if (out.action) {
            const tAct0 = performance.now();
            out.action_result = await this._runAction(out.action);
            out.action_latency_ms = Math.round(performance.now() - tAct0);
        }
        out.total_latency_ms = Math.round(performance.now() - t0);
        return out;
    },

    async _runAction(action) {
        if (!action || typeof action !== 'object') return { dispatched: false };
        if (action.category !== 'homeassistant') {
            return { dispatched: false, reason: `unsupported category: ${action.category}` };
        }
        const cmd = action.command;
        const params = action.parameters || {};
        if (cmd === 'execute_commands') {
            const commands = Array.isArray(params.commands) ? params.commands : [];
            return { dispatched: true, kind: 'execute_commands', results: await this._dispatchExecuteCommands(commands) };
        }
        if (cmd === 'forward_to_assist') {
            return { dispatched: true, kind: 'forward_to_assist', ...(await this._dispatchForwardToAssist(params.transcript || '')) };
        }
        return { dispatched: false, reason: `unsupported command: ${cmd}` };
    },
};

window.ConsoleAiClient = ConsoleAiClient;

/*
   Turn object shape:
   {
     ok: true,
     type: 'response'|'info_request'|'action',
     voice, text, action,
     parsed_ok, raw_content,
     usage: {input_tokens, output_tokens, total_tokens},  // summed across passes
     model, provider,
     latency_ms,                  // gateway round trips only (sum across passes)
     total_latency_ms,            // wall clock incl. fetches and action dispatch
     action_result?: { dispatched, kind, results, error? },
     action_latency_ms?,
     unsupported_tool?: string,   // if the AI asked for a tool we don't have
     stages: [
       { name: 'pass1', latency_ms, model, provider, usage, type, parsed, raw_content },
       { name: 'fetch_entities', latency_ms, entity_count, error? },
       { name: 'pass2', latency_ms, model, provider, usage, type, parsed, raw_content },
     ],
   }
*/
