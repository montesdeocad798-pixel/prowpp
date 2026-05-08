function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.rol === 'superadmin') return next();
  res.redirect('/panel');
}

module.exports = { requireLogin, requireAdmin };
