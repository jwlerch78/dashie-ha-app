#!/usr/bin/env node
// scripts/probe-voice-engines.js — §4.3 HA-shape ground truth.
//
// Dumps the RAW request/response shapes for HA's STT/TTS engine WS commands so
// we can lock the native clients (Piper tts_get_url, Whisper /api/stt/{engine})
// to what THIS HA actually returns, before writing code on top of them. HA's
// command names + payloads have drifted across releases — this is how we stop
// guessing (build plan 20260708 §4.3, §12 "probe a real HA early").
//
// Run against a real HA (read-only; no synthesis unless you pass --tts-sample):
//   DASHIE_HA_URL=https://ha.example.com:8123 \
//   DASHIE_HA_TOKEN=<long-lived-access-token> \
//   node server/scripts/probe-voice-engines.js
//
// Inside the add-on (supervisor), SUPERVISOR_TOKEN is used automatically.
// Flags:
//   --tts-sample   also call tts_get_url on the first TTS engine (REST, §4.1) —
//                  validates the synthesis request shape. Produces a URL, no audio played.
//
// Paste the output back so we can confirm engine_id/voice/header shapes.

const WebSocket = require('ws');

const SAMPLE_TTS = process.argv.includes('--tts-sample');

function resolve() {
    if (process.env.SUPERVISOR_TOKEN) {
        return {
            wsUrl: 'ws://supervisor/core/api/websocket',
            restBase: 'http://supervisor/core',
            token: process.env.SUPERVISOR_TOKEN,
            mode: 'supervisor',
        };
    }
    if (process.env.DASHIE_HA_URL && process.env.DASHIE_HA_TOKEN) {
        const base = process.env.DASHIE_HA_URL.replace(/\/$/, '');
        return {
            wsUrl: base.replace(/^https?:/, m => (m === 'https:' ? 'wss:' : 'ws:')) + '/api/websocket',
            restBase: base,
            token: process.env.DASHIE_HA_TOKEN,
            mode: 'dev-llat',
        };
    }
    return null;
}

const cfg = resolve();
if (!cfg) {
    console.error('No HA config. Set DASHIE_HA_URL + DASHIE_HA_TOKEN (or run under SUPERVISOR_TOKEN).');
    process.exit(1);
}

function connect() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(cfg.wsUrl);
        let id = 1;
        const pending = new Map();
        ws.on('message', (raw) => {
            let m; try { m = JSON.parse(raw.toString()); } catch { return; }
            if (m.type === 'auth_required') { ws.send(JSON.stringify({ type: 'auth', access_token: cfg.token })); return; }
            if (m.type === 'auth_ok') { resolve({ send, close: () => ws.close() }); return; }
            if (m.type === 'auth_invalid') { reject(new Error('auth_invalid: ' + (m.message || ''))); return; }
            if (m.id != null && pending.has(m.id)) {
                const { res } = pending.get(m.id); pending.delete(m.id);
                res(m.success ? { ok: true, result: m.result } : { ok: false, error: m.error });
            }
        });
        ws.on('error', reject);
        function send(payload) {
            return new Promise((res) => {
                const mid = id++;
                pending.set(mid, { res });
                ws.send(JSON.stringify({ id: mid, ...payload }));
                setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); res({ ok: false, error: 'timeout' }); } }, 8000);
            });
        }
    });
}

function show(label, val) {
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(val, null, 2));
}

(async () => {
    console.log(`[probe] connecting to HA (${cfg.mode}) ${cfg.wsUrl}`);
    const ha = await connect();
    console.log('[probe] authed ✓');

    // Try the primary command + a couple of drift-candidates so we see which the
    // installed HA answers.
    const tttsList = await ha.send({ type: 'tts/engine/list' });
    show('tts/engine/list', tttsList);
    const sttList = await ha.send({ type: 'stt/engine/list' });
    show('stt/engine/list', sttList);

    const ttsEngines = tttsList.ok ? (tttsList.result?.providers || tttsList.result || []) : [];
    const sttEngines = sttList.ok ? (sttList.result?.providers || sttList.result || []) : [];

    if (ttsEngines[0]) {
        const eid = ttsEngines[0].engine_id || ttsEngines[0].engineId;
        const langs = ttsEngines[0].supported_languages || ttsEngines[0].supportedLanguages || ['en'];
        const lang = langs.find(l => /^en/i.test(l)) || langs[0] || 'en';
        show(`tts/engine/get { engine_id: ${eid} }`, await ha.send({ type: 'tts/engine/get', engine_id: eid }));
        show(`tts/engine/voices { engine_id: ${eid}, language: ${lang} }`,
            await ha.send({ type: 'tts/engine/voices', engine_id: eid, language: lang }));

        if (SAMPLE_TTS) {
            // §4.1 synthesis shape — REST tts_get_url. Read-only (returns a URL/path).
            const body = { engine_id: eid, message: 'Dashie local voice test.', language: lang };
            console.log(`\n=== POST /api/tts_get_url (${eid}) ===\nrequest: ${JSON.stringify(body)}`);
            try {
                const r = await fetch(`${cfg.restBase}/api/tts_get_url`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                console.log(`response HTTP ${r.status}:`, JSON.stringify(await r.json().catch(() => null), null, 2));
            } catch (e) { console.log('tts_get_url error:', e.message); }
        }
    }

    if (sttEngines[0]) {
        const eid = sttEngines[0].engine_id || sttEngines[0].engineId;
        show(`stt/engine/get { engine_id: ${eid} }`, await ha.send({ type: 'stt/engine/get', engine_id: eid }));
        console.log(`\n[probe] STT transcribe uses REST: POST ${cfg.restBase}/api/stt/${eid}`);
        console.log('        header X-Speech-Content: format=wav; codec=pcm; sample_rate=16000; bit_rate=16; channel=1; language=en');
        console.log('        (not exercised here — needs captured audio; confirm the engine_id above is what the URL wants)');
    }

    ha.close();
    console.log('\n[probe] done. Paste the blocks above back for §4.3 sign-off.');
    process.exit(0);
})().catch(e => { console.error('[probe] failed:', e.message); process.exit(1); });
