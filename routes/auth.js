const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.SESSION_SECRET || 'zenithzoom-secret';

// Generate JWT
function generateToken(user) {
  return jwt.sign({ id: user._id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Name, email and password required' });
    if (password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'Email already registered' });

    const user = await User.create({ name, email, password, phone });
    const token = generateToken(user);
    res.json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });

    const user = await User.findOne({ email });
    if (!user || !user.password) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    user.lastLogin = new Date();
    await user.save();

    const token = generateToken(user);
    res.json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me — get current user + courses
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .populate('purchasedCourses.resourceId', 'title category price filePath cloudinaryId fileName thumbnail')
      .select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/auth/progress — update course progress
router.patch('/progress', requireAuth, async (req, res) => {
  try {
    const { resourceId, progress, totalPages } = req.body;
    const user = await User.findById(req.userId);
    const course = user.purchasedCourses.find(c => c.resourceId.toString() === resourceId);
    if (!course) return res.status(403).json({ success: false, message: 'Course not purchased' });
    course.progress = progress;
    if (totalPages) course.totalPages = totalPages;
    course.lastViewed = new Date();
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/view/:resourceId — get Cloudinary URL for viewing (must own course)
router.get('/view/:resourceId', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const course = user.purchasedCourses.find(c => c.resourceId.toString() === req.params.resourceId);
    if (!course) return res.status(403).json({ success: false, message: 'Purchase this course to view it' });

    const Resource = require('../models/Resource');
    const resource = await Resource.findById(req.params.resourceId);
    if (!resource) return res.status(404).json({ success: false, message: 'Course not found' });

    // Generate signed Cloudinary URL valid for 2 hours
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });

    const viewUrl = cloudinary.utils.private_download_url(
      resource.cloudinaryId, 'pdf',
      { resource_type: 'raw', type: 'upload', expires_at: Math.floor(Date.now() / 1000) + 7200 }
    );

    res.json({ success: true, viewUrl, title: resource.title });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Middleware
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Login required' });
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Session expired. Please login again.' });
  }
}

module.exports = { router, requireAuth };
