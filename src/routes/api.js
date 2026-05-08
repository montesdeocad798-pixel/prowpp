const express = require('express');
const db = require('../database');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const router = express.Router();

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

router.get('/workers', requireLogin, async (req, res) => {
  const companyId = req.session.user.companyId;
  res.json(await db.getWorkersByCompany(companyId));
});

router.post('/workers', requireLogin, async (req, res) => {
  const { nombre, telefono, rol } = req.body;
  const companyId = req.session.user.companyId;
  const worker = await db.createWorker({ nombre, telefono: `+34${telefono.replace(/\D/g,'')}`, rol: rol || 'Trabajador', companyId });
  res.json(worker);
});

router.delete('/workers/:id', requireLogin, async (req, res) => {
  await db.deleteWorker(req.params.id);
  res.json({ ok: true });
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
