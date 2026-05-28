// src/server.js
'use strict';

require('dotenv').config();

// Validate required env vars before anything else
const REQUIRED_ENV = [
  'MONGODB_URI',
  'WHAPI_URL',
  'WHAPI_TOKEN',
  'CASHFREE_APP_ID',
  'CASHFREE_SECRET_KEY',
  'CASHFREE_RETURN_URL',
  'ADMIN_API_KEY',
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[STARTUP] Missing required env vars: ${missing.join(', ')}`);
  console.error('[STARTUP] Copy .env.example to .env and fill in all values.');
  process.exit(1);
}

const path      = require('path');
const express   = require('express');
const cors      = require('cors');
const connectDB = require('./config/database');
const { startReminders } = require('./src/services/reminders');

const webhookRoute = require('./src/routes/webhook');
const paymentRoute = require('./src/routes/payment');
const adminRoute   = require('./src/routes/admin');

const app  = express();
const PORT = parseInt(process.env.PORT || 3000, 10);

// ── MIDDLEWARE ─────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((req, _res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

// ── ROUTES ─────────────────────────────────────────────────────────────────────
// Public landing page
app.get('/',       (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString(), env: process.env.NODE_ENV }));

// Admin dashboard (static HTML — auth happens client-side against /api/admin/*,
// which is itself protected by the x-admin-key header).
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use('/webhook',     webhookRoute);
app.use('/api/payment', paymentRoute);
app.use('/api/admin',   adminRoute);

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[SERVER ERROR]', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── GRACEFUL SHUTDOWN ──────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[SERVER] ${signal} received — shutting down gracefully`);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[SERVER] Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught Exception:', err.message, err.stack);
  process.exit(1);
});

// ── STARTUP ────────────────────────────────────────────────────────────────────
(async () => {
  await connectDB();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'='.repeat(55)}`);
    console.log(` Xurely WhatsApp Bot`);
    console.log(` Port : ${PORT}`);
    console.log(` Env  : ${process.env.NODE_ENV || 'development'}`);
    console.log(` CashFree: ${process.env.CASHFREE_ENV === 'PROD' ? '🔴 PRODUCTION' : '🟡 SANDBOX'}`);
    console.log(`${'='.repeat(55)}\n`);
  });

  startReminders();
})();
