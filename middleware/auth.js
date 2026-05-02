const isAdmin = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin/login');
};

const isAdminAPI = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ success: false, message: 'Unauthorized' });
};

module.exports = { isAdmin, isAdminAPI };
