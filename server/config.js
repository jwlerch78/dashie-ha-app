// server/config.js
// Runtime configuration — environment detection + paths.

const path = require('path');
const fs = require('fs');

// Data directory — /data in HAOS add-on (persistent), ./data locally.
const DATA_DIR = fs.existsSync('/data') && fs.statSync('/data').isDirectory()
    ? '/data'
    : path.resolve(__dirname, '..', 'data');

// Ensure it exists.
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

// Frontend directory — the git submodule under frontend/dashie-console.
const FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend', 'dashie-console');

// Port — configurable via env (HAOS passes via config.yaml).
const PORT = parseInt(process.env.INGRESS_PORT || process.env.PORT || '7123', 10);

// HA Supervisor token — auto-injected by HAOS when add-on declares `hassio_api: true`.
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN || null;

// Supabase environment detection — reuse the same logic the browser console uses.
// For local dev we default to dev database; in production (prod HA add-on release)
// we'll force production. User-selectable for now via DASHIE_SUPABASE_ENV env.
const SUPABASE_ENVIRONMENTS = {
    development: {
        url: 'https://cwglbtosingboqepsmjk.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3Z2xidG9zaW5nYm9xZXBzbWprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NDY4NjYsImV4cCI6MjA3MzIyMjg2Nn0.VCP5DSfAwwZMjtPl33bhsixSiu_lHsM6n42FMJRP3YA',
        googleClientId: '221142210647-58t8hr48rk7nlgl56j969himso1qjjoo.apps.googleusercontent.com',
    },
    production: {
        url: 'https://cseaywxcvnxcsypaqaid.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzZWF5d3hjdm54Y3N5cGFxYWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2MDIxOTEsImV4cCI6MjA3MzE3ODE5MX0.Wnd7XELrtPIDKeTcHVw7dl3awn3BlI0z9ADKPgSfHhA',
        googleClientId: '221142210647-58t8hr48rk7nlgl56j969himso1qjjoo.apps.googleusercontent.com',
    },
};

const SUPABASE_ENV = (process.env.DASHIE_SUPABASE_ENV === 'production') ? 'production' : 'development';
const SUPABASE = SUPABASE_ENVIRONMENTS[SUPABASE_ENV];

module.exports = {
    DATA_DIR,
    FRONTEND_DIR,
    PORT,
    SUPERVISOR_TOKEN,
    SUPABASE_ENV,
    SUPABASE,
    JWT_FILE: path.join(DATA_DIR, 'dashie_auth.json'),
    SERVICE_TOKEN_FILE: path.join(DATA_DIR, 'service_token.txt'),
    CONFIG_FILE: path.join(DATA_DIR, 'config.json'),
};
