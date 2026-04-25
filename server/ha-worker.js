// server/ha-worker.js
// Polls HA /api/states every POLL_INTERVAL_MS, builds per-device metrics, and upserts
// to Supabase via the `update_device_metrics` edge-fn op. Also exposes triggerRefresh()
// so the HTTP layer can do an on-demand poll when a Console refresh broadcast fires.
//
// Design notes:
//  - Non-fatal. If HA is unreachable, the user isn't signed in, or the edge-fn isn't
//    deployed yet, we log and keep looping. The worker never crashes the add-on.
//  - Single-flight: overlapping polls coalesce (if a poll is already in flight when a
//    new tick or on-demand trigger arrives, we note it and run one more poll after).

const haClient = require('./ha-client');
const haMetrics = require('./ha-metrics');
const auth = require('./auth');
const { SUPABASE } = require('./config');

const POLL_INTERVAL_MS = 30 * 1000;
// Metrics upserts go to the database-operations edge fn (where the device handlers live);
// auth.js still talks to jwt-auth for login/refresh.
const DB_OPS_URL = SUPABASE.url + '/functions/v1/database-operations';

let timer = null;
let inFlight = false;
let queued = false;
let lastRun = null;       // { at, devices, ok, error? }
let started = false;
let lastSkipReason = null;  // de-dupes noisy skip-log spam

function logSkip(reason) {
    if (reason === lastSkipReason) return;
    lastSkipReason = reason;
    console.log(`[ha-worker] Skipping poll: ${reason}`);
}

/** Call a database-operations op with the user's JWT. Throws on HTTP error. */
async function callDbOp(operation, data, jwt) {
    const resp = await fetch(DB_OPS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwt}`,
            'apikey': SUPABASE.anonKey,
        },
        body: JSON.stringify({ operation, data }),
    });
    const body = await resp.text();
    if (!resp.ok) {
        throw new Error(`${operation} HTTP ${resp.status}: ${body.slice(0, 400)}`);
    }
    try { return JSON.parse(body); } catch { return { raw: body }; }
}

/** Run one poll cycle: fetch states → build metrics → upsert. */
async function runPoll(reason = 'tick') {
    if (inFlight) {
        queued = true;
        console.log(`[ha-worker] Poll already in flight (${reason}); queued follow-up.`);
        return;
    }
    inFlight = true;
    const startedAt = Date.now();
    try {
        if (!haClient.isAvailable()) {
            lastRun = { at: new Date().toISOString(), ok: false, skipped: 'ha_not_configured' };
            logSkip('HA not configured (no SUPERVISOR_TOKEN and no DASHIE_HA_URL+TOKEN)');
            return;
        }

        let jwtStored;
        try {
            jwtStored = await auth.getValidJwt();
        } catch (e) {
            lastRun = { at: new Date().toISOString(), ok: false, skipped: 'not_authenticated' };
            logSkip('Not authenticated — waiting for user to sign in via /api/auth/start-link');
            return;
        }

        const states = await haClient.getStates();
        const devices = haMetrics.buildDeviceMetrics(states);

        if (devices.length === 0) {
            lastRun = {
                at: new Date().toISOString(),
                ok: true,
                devices: 0,
                note: 'no_dashie_entities',
                durationMs: Date.now() - startedAt,
            };
            console.log('[ha-worker] No Dashie entities found in HA.');
            return;
        }

        // Upsert metrics via database-operations edge fn. Tolerant of the op not being
        // deployed yet (logs once, keeps looping).
        let upsertResult = null;
        try {
            upsertResult = await callDbOp('update_device_metrics', {
                devices: devices.map(d => ({
                    device_id: d.dashieDeviceId,
                    device_name: d.deviceName,        // anchor friendly_name minus " Device ID"
                    ha_device_name: d.deviceName,     // same source; sent so the edge fn / Console can detect collisions
                    metrics: d.metrics,
                    has_live_data: d.hasLiveData,
                })),
            }, jwtStored.jwt);
        } catch (e) {
            lastRun = {
                at: new Date().toISOString(),
                ok: false,
                devices: devices.length,
                error: e.message,
                durationMs: Date.now() - startedAt,
            };
            if (e.message.includes('HTTP 404') || e.message.toLowerCase().includes('unknown operation')) {
                console.warn(`[ha-worker] Edge-fn update_device_metrics not deployed yet — built ${devices.length} device record(s) but skipped upsert.`);
            } else {
                console.warn(`[ha-worker] Upsert failed: ${e.message}`);
            }
            return;
        }

        const updated = upsertResult?.updated ?? 0;
        const unmatched = upsertResult?.unmatched?.length ?? 0;
        const skippedNoId = upsertResult?.skipped?.length ?? 0;
        lastRun = {
            at: new Date().toISOString(),
            ok: true,
            devices: devices.length,
            live: devices.filter(d => d.hasLiveData).length,
            updated,
            unmatched,
            skippedNoId,
            durationMs: Date.now() - startedAt,
            upsertResult,
        };
        console.log(`[ha-worker] Poll ok (${reason}): ${devices.length} device(s), ${lastRun.live} live → ${updated} upserted, ${unmatched} unmatched, ${skippedNoId} no-id, ${lastRun.durationMs}ms`);
        if (unmatched > 0) {
            const names = upsertResult.unmatched.map(u => u.device_name).join(', ');
            console.log(`[ha-worker] Unmatched devices (not claimed into this account): ${names}`);
        }
        lastSkipReason = null;  // reset so next skip (if any) re-logs
    } catch (e) {
        lastRun = {
            at: new Date().toISOString(),
            ok: false,
            error: e.message,
            durationMs: Date.now() - startedAt,
        };
        console.warn(`[ha-worker] Poll failed: ${e.message}`);
    } finally {
        inFlight = false;
        if (queued) {
            queued = false;
            // Defer one tick so a rapid burst of triggers doesn't hammer the loop.
            setImmediate(() => runPoll('queued'));
        }
    }
}

function start() {
    if (started) return;
    started = true;
    console.log(`[ha-worker] Starting — interval ${POLL_INTERVAL_MS / 1000}s, HA ${haClient.isAvailable() ? 'configured' : 'NOT configured (worker will idle)'}.`);
    // Kick off one poll soon after start so we don't wait a full interval for first data.
    setTimeout(() => runPoll('startup'), 3000);
    timer = setInterval(() => runPoll('tick'), POLL_INTERVAL_MS);
    if (timer.unref) timer.unref();
}

function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    started = false;
}

/** On-demand poll. Safe to call concurrently — coalesces. */
function triggerRefresh(reason = 'on-demand') {
    return runPoll(reason);
}

function getStatus() {
    return {
        started,
        inFlight,
        queued,
        intervalMs: POLL_INTERVAL_MS,
        lastRun,
        haAvailable: haClient.isAvailable(),
    };
}

module.exports = { start, stop, triggerRefresh, getStatus };
