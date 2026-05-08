const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.rol === 'superadmin' ? '/admin' : '/panel');
  res.sendFile(require('path').join(__dirname, '../../public/login.html'));
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.getUserByEmail(email);
  if (!user) return res.redirect('/login?error=1');
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.redirect('/login?error=1');
  req.session.user = { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol, companyId: user.company_id };
  res.redirect(user.rol === 'superadmin' ? '/admin' : '/panel');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;
