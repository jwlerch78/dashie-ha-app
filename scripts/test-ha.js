// scripts/test-ha.js
// Probe real HA for Dashie entities and print the metrics JSONB each tablet
// would upsert. Uses the shared ha-metrics module so the worker and this
// script can't drift out of sync.
//
// Run: npm run test:ha

const path = require('path');
const haClient = require(path.resolve(__dirname, '..', 'server', 'ha-client.js'));
const haMetrics = require(path.resolve(__dirname, '..', 'server', 'ha-metrics.js'));

(async () => {
    console.log('[test-ha] Checking connection...');
    const conn = await haClient.checkConnection();
    console.log('[test-ha]', conn);
    if (!conn.ok) process.exit(1);

    console.log('[test-ha] Fetching /api/states...');
    const states = await haClient.getStates();
    console.log(`[test-ha] Got ${states.length} total states.`);

    const devices = haMetrics.buildDeviceMetrics(states);
    console.log(`[test-ha] Grouped into ${devices.length} Dashie tablet(s):`);
    for (const d of devices) {
        console.log(`  - ${d.deviceName}  (${d.entityCount} entities, ${d.hasLiveData ? 'live' : 'no live data'})`);
    }
    console.log('');

    for (const d of devices) {
        console.log('='.repeat(70));
        console.log(`Device: ${d.deviceName}`);
        console.log(`Dashie device_id: ${d.dashieDeviceId || '(none — _device_id sensor missing/unavailable)'}`);
        console.log('Metrics JSONB:');
        console.log(JSON.stringify(d.metrics, null, 2));
        console.log('');
    }
})().catch(e => {
    console.error('[test-ha] Error:', e.message);
    console.error(e.stack);
    process.exit(1);
});
