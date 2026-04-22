// server/index.js
// Dashie HA add-on — Express server.

const path = require('path');
const fs = require('fs');
const express = require('express');

const { PORT, FRONTEND_DIR, DATA_DIR, SUPABASE_ENV, SUPABASE } = require('./config');
const authRouter = require('./api/auth');

const app = express();

// ------------------------------------------------------------------
//  Startup banner
// ------------------------------------------------------------------

console.log('='.repeat(60));
console.log('Dashie HA Add-on');
console.log('='.repeat(60));
console.log(`Data dir:        ${DATA_DIR}`);
console.log(`Frontend dir:    ${FRONTEND_DIR}`);
console.log(`Supabase env:    ${SUPABASE_ENV}`);
console.log(`Supabase URL:    ${SUPABASE.url}`);
console.log(`Port:            ${PORT}`);
console.log(`Supervisor tok:  ${process.env.SUPERVISOR_TOKEN ? '(present)' : '(none)'}`);
console.log('='.repeat(60));

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
//  Frontend static files (dashie-console git submodule)
// ------------------------------------------------------------------

if (!fs.existsSync(FRONTEND_DIR)) {
    console.error(`[fatal] Frontend directory not found: ${FRONTEND_DIR}`);
    console.error('[fatal] Did you run: git submodule update --init --recursive ?');
    process.exit(1);
}

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
// On localhost this still resolves to 127.0.0.1 requests as expected.
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Dashie add-on listening on 0.0.0.0:${PORT}`);
});
