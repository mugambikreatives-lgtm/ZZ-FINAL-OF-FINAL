const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.SESSION_SECRET || 'zenithzoom-secret';

// Middleware to verify JWT
function authMiddleware(req, res, next) {
  const token = req.cookies?.zz_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, message: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

function makeToken(user) {
  return jwt.sign({ id: user._id, name: user.name, email: user.email, avatar: user.avatar }, JWT_SECRET, { expiresIn: '30d' });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'All fields required' });
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ success: false, message: 'Email already registered' });
    const user = await User.create({ name, email, password });
    const token = makeToken(user);
    res.cookie('zz_token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    res.json({ success: true, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.password) return res.status(400).json({ success: false, message: 'Invalid email or password' });
    const match = await user.comparePassword(password);
    if (!match) return res.status(400).json({ success: false, message: 'Invalid email or password' });
    const token = makeToken(user);
    res.cookie('zz_token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    res.json({ success: true, user: { id: user._id, name: user.name, email: user.email, avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('purchasedCourses.courseId', 'title category price thumbnail')
      .select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('zz_token');
  res.json({ success: true });
});

// PATCH /api/auth/progress — update course progress
router.patch('/progress', authMiddleware, async (req, res) => {
  try {
    const { courseId, progress, lastPage, completed } = req.body;
    const user = await User.findById(req.user.id);
    const course = user.purchasedCourses.find(c => c.courseId.toString() === courseId);
    if (!course) return res.status(404).json({ success: false, message: 'Course not purchased' });
    if (progress !== undefined) course.progress = progress;
    if (lastPage !== undefined) course.lastPage = lastPage;
    if (completed !== undefined) course.completed = completed;
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/view/:courseId — get Cloudinary URL for purchased course
router.get('/view/:courseId', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const purchased = user.purchasedCourses.find(c => c.courseId.toString() === req.params.courseId);
    if (!purchased) return res.status(403).json({ success: false, message: 'Course not purchased' });
    const Resource = require('../models/Resource');
    const course = await Resource.findById(req.params.courseId);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
    // Generate 2-hour signed URL for viewing
    const viewUrl = cloudinary.utils.private_download_url(
      course.cloudinaryId, 'pdf',
      { resource_type: 'raw', type: 'upload', expires_at: Math.floor(Date.now() / 1000) + 7200 }
    );
    res.json({ success: true, url: viewUrl });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = { router, authMiddleware };
