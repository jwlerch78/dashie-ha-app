// server/index.js
// Dashie HA add-on — Express server.

// Catch ANY error before we even get to Express so it shows up in the add-on Log tab.
process.on('uncaughtException', (err) => {
    console.error('[fatal] Uncaught exception:', err?.stack || err);
    process.exit(1);
});
process.on('unhandledRejection', (err) => {
    console.error('[fatal] Unhandled rejection:', err?.stack || err);
    process.exit(1);
});

let path, fs, express, config, authRouter;
try {
    path = require('path');
    fs = require('fs');
    express = require('express');
    config = require('./config');
    authRouter = require('./api/auth');
} catch (err) {
    console.error('[fatal] Failed to load modules:', err?.stack || err);
    console.error('[fatal] Node version:', process.version);
    console.error('[fatal] cwd:', process.cwd());
    console.error('[fatal] __dirname:', __dirname);
    process.exit(1);
}

const { PORT, FRONTEND_DIR, DATA_DIR, SUPABASE_ENV, SUPABASE } = config;
const app = express();

// ------------------------------------------------------------------
//  Startup banner
// ------------------------------------------------------------------

console.log('='.repeat(60));
console.log('Dashie HA Add-on');
console.log('='.repeat(60));
console.log(`Node version:    ${process.version}`);
console.log(`cwd:             ${process.cwd()}`);
console.log(`Data dir:        ${DATA_DIR} (${fs.existsSync(DATA_DIR) ? 'exists' : 'MISSING'})`);
console.log(`Frontend dir:    ${FRONTEND_DIR} (${fs.existsSync(FRONTEND_DIR) ? 'exists' : 'MISSING'})`);
console.log(`Supabase env:    ${SUPABASE_ENV}`);
console.log(`Supabase URL:    ${SUPABASE.url}`);
console.log(`Port:            ${PORT}`);
console.log(`Supervisor tok:  ${process.env.SUPERVISOR_TOKEN ? '(present, len=' + process.env.SUPERVISOR_TOKEN.length + ')' : '(MISSING)'}`);
console.log(`INGRESS_PORT:    ${process.env.INGRESS_PORT || '(not set)'}`);
console.log('='.repeat(60));

// ------------------------------------------------------------------
//  Fatal checks before starting
// ------------------------------------------------------------------

if (!fs.existsSync(FRONTEND_DIR)) {
    console.error(`[fatal] Frontend directory not found: ${FRONTEND_DIR}`);
    console.error('[fatal] /app contents:');
    try {
        const appContents = fs.readdirSync('/app');
        appContents.forEach(f => console.error(`  ${f}`));
    } catch (e) {
        console.error(`  (could not read /app: ${e.message})`);
    }
    process.exit(1);
}

// ------------------------------------------------------------------
//  API routes
// ------------------------------------------------------------------

app.use('/api/auth', authRouter);

// Lightweight runtime-info endpoint the frontend uses to detect it's running
// inside the add-on (vs standalone on dashieapp.com/console).
app.get('/api/runtime', (req, res) => {
    res.json({
        addon: true,
        version: require('../package.json').version,
        supabase_env: SUPABASE_ENV,
    });
});

// ------------------------------------------------------------------
//  Frontend static files
// ------------------------------------------------------------------

// Serve the frontend at root. HAOS Ingress also serves us at root (after it strips
// its dynamic /api/hassio_ingress/<token>/ prefix), so relative URLs in the SPA
// resolve consistently across both local dev and inside HA.
app.use('/', express.static(FRONTEND_DIR));

// SPA fallback — route non-API, non-file requests to index.html so the frontend
// router handles them. Simple heuristic: if the path looks like a file (has a
// dot) we let it 404 normally; otherwise serve index.html.
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (req.path.includes('.')) return next();
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ------------------------------------------------------------------
//  Error handler
// ------------------------------------------------------------------

app.use((err, req, res, next) => {
    console.error('[server error]', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'server_error', message: err.message });
});

// ------------------------------------------------------------------
//  Start
// ------------------------------------------------------------------

// Bind to 0.0.0.0 so HAOS Ingress (running in a sibling container) can reach us.
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Dashie add-on listening on 0.0.0.0:${PORT}`);
    console.log('[server] Ready to accept requests from HA Ingress.');
});

server.on('error', (err) => {
    console.error('[fatal] Server error:', err?.stack || err);
    if (err.code === 'EADDRINUSE') {
        console.error(`[fatal] Port ${PORT} is already in use.`);
    }
    process.exit(1);
});
