/* ============================================================
   ConsoleAiClient — test-chat surface to the same ai-gateway
   the tablets use.
   ------------------------------------------------------------
   Public API:
     await ConsoleAiClient.sendQuery(text, {
        personalityId, modelId, history
     }) → {
        voice, text, action, type,
        usage: {input_tokens, output_tokens, total_tokens},
        model, provider,
        latency_ms,            // wall-clock for the gateway round trip
        total_latency_ms,      // includes personality fetch + action dispatch
        action_result          // when type === 'action' and dispatch ran
     }

   Pipeline:
     1. Resolve personality (cached) via DashieAuth.dbRequest('get_personality').
     2. Build a system prompt = personality prefix + JSON-format spec.
     3. POST to ai-gateway with {provider, prompt, options.model}.
     4. Strip markdown fences and JSON.parse the content.
     5. If action.category === 'homeassistant', dispatch via the add-on
        (POST /api/ha/service) and attach the result.
     6. Return everything the chat UI needs to render a turn.

   Sandboxing:
     - ai-gateway does no analytics logging itself, only console.log.
     - The structured client-side analytics path (ai-service.js in the
       webapp) is bypassed entirely. Test-chat traffic does not appear
       in production usage metrics.
   ============================================================ */

const ConsoleAiClient = {
    /** Cache: personalityId → resolved row from get_personality. */
    _personalityCache: new Map(),

    /** Pick the AI provider for a given model id by prefix. Mirrors the
     *  webapp's provider switch — anything we don't recognize defaults to
     *  Claude, the same as the gateway's fallback. */
    _providerForModel(modelId) {
        if (!modelId || typeof modelId !== 'string') return 'claude';
        const id = modelId.toLowerCase();
        if (id.startsWith('claude-')) return 'claude';
        if (id.startsWith('gpt-'))    return 'openai';
        if (id.startsWith('o1')   || id.startsWith('o3')) return 'openai';
        if (id.startsWith('gemini-')) return 'gemini';
        if (id.startsWith('bedrock-')) return 'bedrock';
        return 'claude';
    },

    /** Fetch a personality row (memoized). Returns null if the id resolves
     *  to nothing — caller falls back to a plain system prompt. */
    async _getPersonality(personalityId) {
        if (!personalityId) return null;
        if (this._personalityCache.has(personalityId)) {
            return this._personalityCache.get(personalityId);
        }
        try {
            const result = await DashieAuth.dbRequest('get_personality', { id: personalityId });
            const row = result?.data || result?.personality || null;
            this._personalityCache.set(personalityId, row);
            return row;
        } catch (e) {
            console.warn('[ConsoleAiClient] get_personality failed for', personalityId, e?.message);
            // Try by key (built-in personalities are keyed, not UUIDed).
            try {
                const result = await DashieAuth.dbRequest('get_personality', { key: personalityId });
                const row = result?.data || result?.personality || null;
                this._personalityCache.set(personalityId, row);
                return row;
            } catch (e2) {
                this._personalityCache.set(personalityId, null);
                return null;
            }
        }
    },

    /** Build the personality wrapper for the system prompt. Mirrors the
     *  webapp's personality-prompt-builder roughly — overview + adjectives
     *  + topics up front, example phrases + family notes at the end. The
     *  test-chat doesn't need every nuance of the production prompt path;
     *  it needs to verify the personality steers the response. */
    _personalityWrap(personality) {
        if (!personality) return { prefix: '', suffix: '' };
        const parts = [];
        if (personality.personality_overview) parts.push(personality.personality_overview);
        if (personality.similar_persona)      parts.push(`Channel a personality similar to ${personality.similar_persona}.`);
        if (Array.isArray(personality.adjectives) && personality.adjectives.length) {
            parts.push(`Be ${personality.adjectives.join(', ')} in your responses.`);
        }
        if (Array.isArray(personality.topics) && personality.topics.length) {
            parts.push(`Topics you naturally reference: ${personality.topics.join(', ')}.`);
        }
        const prefix = parts.length
            ? `Embody this character (${personality.name || personality.key || 'persona'}):\n${parts.join('\n')}\n\n`
            : '';

        const suffixParts = [];
        if (Array.isArray(personality.example_phrases) && personality.example_phrases.length) {
            suffixParts.push(`Use phrases like:\n${personality.example_phrases.map(p => `  - "${p}"`).join('\n')}`);
        }
        if (personality.family_notes) {
            suffixParts.push(`Family-specific notes: ${personality.family_notes}`);
        }
        suffixParts.push("VARY YOUR RESPONSES — don't start every reply the same way.");
        const suffix = '\n\n' + suffixParts.join('\n\n');
        return { prefix, suffix };
    },

    /** The structured JSON response contract the tablets parse against. */
    _RESPONSE_FORMAT_SPEC: `\
You must respond ONLY with a single JSON object — no markdown fences, no commentary.

Shape:
  {
    "type": "response" | "action",
    "voice": "<max 20 words; the spoken portion>",
    "text": "<optional; up to 100 words; extra details NOT in voice; null if none>",
    "action": null | {
      "category": "homeassistant",
      "command": "execute_commands" | "forward_to_assist",
      "parameters": {
        // For execute_commands:
        //   "commands": [{ "domain": "light", "service": "turn_on", "data": { "entity_id": "light.kitchen" } }, ...]
        // For forward_to_assist:
        //   "transcript": "<verbatim user request>"
      }
    }
  }

Rules:
  - type "response" → answer the user. Set action to null.
  - type "action"   → user is asking to control Home Assistant. Set
                      voice to a brief acknowledgement, fill action with
                      the service call(s) to fire, and leave text null
                      unless the user asked a question alongside the
                      command.
  - Always include voice. Keep it speakable.
  - When unsure whether to act, use forward_to_assist and let HA's
    Assist parse the transcript.`,

    _buildSystemPrompt(personality, userText, history) {
        const { prefix, suffix } = this._personalityWrap(personality);
        const histBlock = (Array.isArray(history) && history.length)
            ? '\n\nRecent conversation:\n' + history.slice(-4).map(h => {
                const role = h.role === 'user' ? 'User' : 'You';
                const content = h.voice || h.text || h.content || '';
                return `${role}: ${content}`;
            }).join('\n')
            : '';
        return `${prefix}${this._RESPONSE_FORMAT_SPEC}${histBlock}\n\nUser request: ${userText}${suffix}`;
    },

    /** Strip markdown code fences and parse the AI's JSON response. */
    _parseContent(content) {
        if (!content || typeof content !== 'string') return null;
        let body = content.trim();
        // ```json ... ``` or ``` ... ```
        body = body.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        // Some models prepend an "Output:" or similar — strip up to the first {.
        const firstBrace = body.indexOf('{');
        if (firstBrace > 0) body = body.slice(firstBrace);
        const lastBrace = body.lastIndexOf('}');
        if (lastBrace > 0 && lastBrace < body.length - 1) body = body.slice(0, lastBrace + 1);
        try {
            return JSON.parse(body);
        } catch (e) {
            return null;
        }
    },

    /** Fire an HA action via the add-on. Only HOMEASSISTANT actions are
     *  routed today; other categories return a stub so the UI can show
     *  them without failing. */
    async _dispatchAction(action) {
        if (!action || typeof action !== 'object') return { dispatched: false };
        if (action.category !== 'homeassistant') {
            return { dispatched: false, reason: `unsupported category: ${action.category}` };
        }
        const cmd = action.command;
        const params = action.parameters || {};

        if (cmd === 'execute_commands') {
            const commands = Array.isArray(params.commands) ? params.commands : [];
            const results = [];
            for (const c of commands) {
                try {
                    const resp = await fetch(DashieAuth._addonUrl('/api/ha/service'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            domain: c.domain,
                            service: c.service,
                            data: c.data || {},
                        }),
                    });
                    const body = await resp.json().catch(() => ({}));
                    results.push({
                        domain: c.domain, service: c.service, data: c.data || {},
                        ok: resp.ok && body.success !== false,
                        error: !resp.ok || body.success === false
                            ? (body.message || body.error || `HTTP ${resp.status}`)
                            : null,
                    });
                } catch (e) {
                    results.push({
                        domain: c.domain, service: c.service, data: c.data || {},
                        ok: false, error: e?.message || String(e),
                    });
                }
            }
            return { dispatched: true, kind: 'execute_commands', results };
        }

        if (cmd === 'forward_to_assist') {
            try {
                const resp = await fetch(DashieAuth._addonUrl('/api/ha/conversation'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: params.transcript || '' }),
                });
                const body = await resp.json().catch(() => ({}));
                return {
                    dispatched: resp.ok,
                    kind: 'forward_to_assist',
                    response: body,
                    error: resp.ok ? null : (body.message || body.error || `HTTP ${resp.status}`),
                };
            } catch (e) {
                return { dispatched: false, kind: 'forward_to_assist', error: e?.message || String(e) };
            }
        }

        return { dispatched: false, reason: `unsupported command: ${cmd}` };
    },

    /** Main entry point. */
    async sendQuery(text, opts = {}) {
        const t0 = performance.now();
        const personalityId = opts.personalityId || null;
        const modelId = opts.modelId || 'claude-sonnet-4-5';
        const history = Array.isArray(opts.history) ? opts.history : [];

        const personality = await this._getPersonality(personalityId);
        const provider = this._providerForModel(modelId);
        const prompt = this._buildSystemPrompt(personality, text, history);

        const gatewayUrl = `${DashieAuth.config.url}/functions/v1/ai-gateway`;
        const tGateway0 = performance.now();
        let raw, gatewayError;
        try {
            const resp = await fetch(gatewayUrl, {
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
                    options: { model: modelId, max_tokens: 512, temperature: 0.7 },
                }),
            });
            const body = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                gatewayError = body.error || body.message || `HTTP ${resp.status}`;
            } else {
                raw = body;
            }
        } catch (e) {
            gatewayError = e?.message || String(e);
        }
        const tGateway1 = performance.now();

        if (gatewayError) {
            return {
                ok: false,
                error: gatewayError,
                latency_ms: Math.round(tGateway1 - tGateway0),
                total_latency_ms: Math.round(tGateway1 - t0),
            };
        }

        const parsed = this._parseContent(raw.content);
        const out = {
            ok: true,
            type: parsed?.type || 'response',
            voice: parsed?.voice || raw.content || '',
            text: parsed?.text || null,
            action: parsed?.action || null,
            raw_content: raw.content,
            parsed_ok: !!parsed,
            usage: raw.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
            model: raw.model || modelId,
            provider: raw.provider || provider,
            latency_ms: Math.round(tGateway1 - tGateway0),
        };

        if (out.action) {
            const tAct0 = performance.now();
            out.action_result = await this._dispatchAction(out.action);
            out.action_latency_ms = Math.round(performance.now() - tAct0);
        }

        out.total_latency_ms = Math.round(performance.now() - t0);
        return out;
    },
};

window.ConsoleAiClient = ConsoleAiClient;
