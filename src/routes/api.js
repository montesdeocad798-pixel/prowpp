const express = require('express');
const db = require('../database');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// ── INFO USUARIO ─────────────────────────────
router.get('/me', requireLogin, async (req, res) => {
  const user = req.session.user;
  const company = user.companyId ? await db.getCompanyById(user.companyId) : null;
  res.json({
    nombre: user.nombre,
    email: user.email,
    empresa: company ? company.nombre : 'Prowpp',
    sector: company ? company.sector : '',
  });
});

// ── STATS EMPRESA ────────────────────────────
router.get('/stats', requireLogin, async (req, res) => {
  const companyId = req.session.user.companyId;
  res.json(await db.getStatsEmpresa(companyId));
});

// ── PANEL JEFE ───────────────────────────────
router.get('/estado', requireLogin, async (req, res) => {
  const companyId = req.session.user.companyId;
  res.json(await db.getEstadoEquipo(companyId));
});

router.get('/fichajes', requireLogin, async (req, res) => {
  const companyId = req.session.user.companyId;
  res.json(await db.getFichajesByCompany(companyId, req.query.periodo || 'hoy'));
});

router.get('/gastos', requireLogin, async (req, res) => {
  const companyId = req.session.user.companyId;
  res.json(await db.getGastosByCompany(companyId));
});

router.patch('/gastos/:id/estado', requireLogin, async (req, res) => {
  const { estado } = req.body;
  if (!['verificado', 'rechazado', 'pendiente'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  await db.updateGastoEstado(req.params.id, estado);
  res.json({ ok: true });
});

router.get('/workers', requireLogin, async (req, res) => {
  const companyId = req.session.user.companyId;
  res.json(await db.getWorkersByCompany(companyId));
});

router.post('/workers', requireLogin, async (req, res) => {
  const { nombre, telefono, rol } = req.body;
  const companyId = req.session.user.companyId;
  const worker = await db.createWorker({
    nombre, telefono: `+34${telefono.replace(/\D/g, '')}`, rol: rol || 'Trabajador', companyId,
  });
  res.json(worker);
});

router.delete('/workers/:id', requireLogin, async (req, res) => {
  await db.deleteWorker(req.params.id);
  res.json({ ok: true });
});

// ── ASISTENTE IA ─────────────────────────────
router.post('/asistente', requireLogin, async (req, res) => {
  const { mensaje, historial } = req.body;
  if (!mensaje || !mensaje.trim()) return res.status(400).json({ error: 'Mensaje vacío' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'sk-ant-placeholder' || apiKey.includes('placeholder')) {
    return res.json({
      respuesta: 'El asistente IA estará disponible en breve. Para consultas urgentes contacta con soporte: montesdeocad798@gmail.com',
    });
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const messages = (historial || []).map(m => ({ role: m.rol, content: m.texto }));
    messages.push({ role: 'user', content: mensaje });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `Eres Prowpp Assistant, un asistente laboral experto en legislación española para empresas de construcción, electricidad, fontanería y oficios.
Ayudas a los jefes de empresa con: jornada laboral, vacaciones, contratos, nóminas, seguridad en obra, PRL, gestión de equipos, gastos deducibles y dudas cotidianas de gestión.
Responde en español de forma clara, directa y práctica. Si no sabes algo con certeza, recomienda consultar con un asesor laboral.
No des respuestas demasiado largas — ve al grano.`,
      messages,
    });

    res.json({ respuesta: response.content[0].text });
  } catch (err) {
    console.error('Error asistente IA:', err.message);
    res.json({ respuesta: 'Error al conectar con el asistente. Inténtalo de nuevo en unos segundos.' });
  }
});

// ── SUPER ADMIN ──────────────────────────────
router.get('/admin/companies', requireAdmin, async (req, res) => {
  const companies = await db.getAllCompanies();
  const withStats = await Promise.all(companies.map(async c => {
    const workers = await db.getWorkersByCompany(c.id);
    return { ...c, totalWorkers: workers.length };
  }));
  res.json(withStats);
});

router.post('/admin/companies', requireAdmin, async (req, res) => {
  const { nombre, sector, jefeNombre, jefeEmail, jefePassword } = req.body;
  const company = await db.createCompany({ nombre, sector });
  const user = await db.createUser({ nombre: jefeNombre, email: jefeEmail, password: jefePassword, companyId: company.id });
  res.json({ company, user });
});

router.get('/admin/users', requireAdmin, async (req, res) => {
  res.json(await db.getAllUsers());
});

router.get('/admin/stats', requireAdmin, async (req, res) => {
  const companies = await db.getAllCompanies();
  const users = await db.getAllUsers();
  res.json({ totalEmpresas: companies.length, totalJefes: users.length });
});

module.exports = router;
