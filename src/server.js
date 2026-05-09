require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./database');

const app = express();

// ── Sesiones persistentes en PostgreSQL ───────
let sessionStore;
if (process.env.DATABASE_URL) {
  const pgSession = require('connect-pg-simple')(session);
  sessionStore = new pgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'session',
    createTableIfMissing: true,
    ssl: !process.env.DATABASE_URL.includes('localhost')
      ? { rejectUnauthorized: false } : false,
  });
}

// ── Middlewares ───────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'prowpp-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// ── Rutas ─────────────────────────────────────
app.use('/', require('./routes/auth'));
app.use('/api', require('./routes/api'));
app.use('/bot', require('./routes/bot'));

// ── Páginas ───────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/landing/index.html'));
});

app.get('/panel', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, '../public/panel/index.html'));
});

app.get('/admin', (req, res) => {
  if (!req.session.user || req.session.user.rol !== 'superadmin') return res.redirect('/login');
  res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

// ── Arranque ──────────────────────────────────
db.init().then(() => {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`✅ Prowpp arrancado en puerto ${PORT}`);
  });
}).catch(err => {
  console.error('❌ Error arrancando:', err);
  process.exit(1);
});
