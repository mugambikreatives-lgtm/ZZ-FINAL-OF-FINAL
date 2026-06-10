const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Resource = require('../models/Resource');

const JWT_SECRET = process.env.SESSION_SECRET || 'zenithzoom-secret'; // must match routes/auth.js

// Middleware to get current user from session or JWT
function authMiddleware(req, res, next) {
  const token = req.session.userToken || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }
}

// POST /api/user/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'All fields required' });
    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists)
      return res.status(400).json({ success: false, message: 'Email already registered. Please log in.' });
    const user = await User.create({ name, email, password });
    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    req.session.userToken = token;
    res.json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/user/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    user.lastLoginAt = new Date();
    await user.save();
    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    req.session.userToken = token;
    res.json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/user/logout
router.post('/logout', (req, res) => {
  req.session.userToken = null;
  res.json({ success: true });
});

// GET /api/user/me — get current user + purchases
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('purchases.resourceId', 'title category price thumbnail');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user: {
      id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      phone: user.phone,
      purchases: user.purchases,
      createdAt: user.createdAt
    }});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/user/view/:resourceId — view a purchased PDF
router.get('/view/:resourceId', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const purchase = user.purchases.find(p => p.resourceId.toString() === req.params.resourceId);
    if (!purchase) return res.status(403).json({ success: false, message: 'You have not purchased this course' });
    const resource = await Resource.findById(req.params.resourceId);
    if (!resource) return res.status(404).json({ success: false, message: 'Course not found' });

    // Update last viewed
    purchase.lastViewedAt = new Date();
    await user.save();

    // Return the Cloudinary URL (for iframe viewer)
    res.json({ success: true, url: resource.filePath, title: resource.title });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/user/progress/:resourceId — update reading progress
router.post('/progress/:resourceId', authMiddleware, async (req, res) => {
  try {
    const { progress } = req.body; // 0-100
    const user = await User.findById(req.user.id);
    const purchase = user.purchases.find(p => p.resourceId.toString() === req.params.resourceId);
    if (!purchase) return res.status(403).json({ success: false, message: 'Not purchased' });
    purchase.progress = Math.min(100, Math.max(0, progress));
    if (purchase.progress >= 95 && !purchase.completedAt) purchase.completedAt = new Date();
    await user.save();
    res.json({ success: true, progress: purchase.progress });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/user/google — Google OAuth redirect
router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = encodeURIComponent(`${process.env.SITE_URL || 'https://zeithzoom.com'}/api/user/google/callback`);
  const scope = encodeURIComponent('openid email profile');
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`);
});

// GET /api/user/google/callback
router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect('/?auth=error');

    // Exchange code for token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${process.env.SITE_URL || 'https://zeithzoom.com'}/api/user/google/callback`,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect('/?auth=error');

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const googleUser = await userRes.json();

    // Find or create user
    let user = await User.findOne({ $or: [{ googleId: googleUser.id }, { email: googleUser.email }] });
    if (!user) {
      user = await User.create({
        name: googleUser.name,
        email: googleUser.email,
        googleId: googleUser.id,
        avatar: googleUser.picture
      });
    } else {
      user.googleId = googleUser.id;
      user.avatar = googleUser.picture;
      user.lastLoginAt = new Date();
      await user.save();
    }

    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    req.session.userToken = token;
    res.redirect(`/?auth=success&token=${token}`);
  } catch (err) {
    console.error('Google auth error:', err);
    res.redirect('/?auth=error');
  }
});

module.exports = router;
module.exports.authMiddleware = authMiddleware;
