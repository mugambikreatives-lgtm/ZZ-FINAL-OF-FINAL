const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Resource = require('../models/Resource');
const Job = require('../models/Job');
const Payment = require('../models/Payment');
const { isAdmin } = require('../middleware/auth');

// Login page
router.get('/login', (req, res) => {
  if (req.session?.isAdmin) return res.redirect('/admin/dashboard');
  res.sendFile(require('path').join(__dirname, '../views/admin-login.html'));
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin || !(await admin.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    req.session.isAdmin = true;
    req.session.adminEmail = email;
    res.json({ success: true, redirect: '/admin/dashboard' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

router.get('/dashboard', isAdmin, (req, res) => {
  res.sendFile(require('path').join(__dirname, '../views/admin-dashboard.html'));
});

// Stats API
router.get('/api/stats', isAdmin, async (req, res) => {
  try {
    const [resources, jobs, payments, revenue] = await Promise.all([
      Resource.countDocuments({ isActive: true }),
      Job.countDocuments({ isActive: true }),
      Payment.countDocuments({ status: 'completed' }),
      Payment.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }])
    ]);
    res.json({ success: true, resources, jobs, payments, revenue: revenue[0]?.total || 0 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Recent payments
router.get('/api/payments', isAdmin, async (req, res) => {
  try {
    const payments = await Payment.find().sort('-createdAt').limit(20).populate('resourceId', 'title');
    res.json({ success: true, payments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Public CV price endpoint (no auth needed)
router.get('/api/cv-price', async (req, res) => {
  try {
    const Setting = require('../models/Setting');
    const price = await Setting.get('cvPrice', 100);
    res.json({ success: true, price });
  } catch (err) {
    res.json({ success: true, price: 100 });
  }
});

// GET settings
router.get('/api/settings', isAdmin, async (req, res) => {
  try {
    const Setting = require('../models/Setting');
    const cvPrice = await Setting.get('cvPrice', 100);
    res.json({ success: true, cvPrice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST update settings
router.post('/api/settings', isAdmin, async (req, res) => {
  try {
    const Setting = require('../models/Setting');
    const { cvPrice } = req.body;
    if (cvPrice !== undefined) {
      await Setting.set('cvPrice', parseInt(cvPrice));
    }
    res.json({ success: true, message: 'Settings saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
