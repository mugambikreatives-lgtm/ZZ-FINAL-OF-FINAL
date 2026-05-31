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
    const { phone } = req.body;
    const user = await User.create({ name, email, password, phone });
    // Link any prior M-Pesa payments to this account
    try {
      const Payment = require('../models/Payment');
      const Resource = require('../models/Resource');
      const phone254 = (phone || '').replace(/^0/, '254').replace(/^\+/, '');
      const payments = await Payment.find({ phone: { $in: [phone, phone254] }, status: 'completed', type: 'resource' });
      for (const p of payments) {
        if (p.resourceId) {
          const alreadyOwns = user.purchasedCourses.some(c => c.courseId?.toString() === p.resourceId.toString());
          if (!alreadyOwns) user.purchasedCourses.push({ courseId: p.resourceId });
        }
      }
      if (payments.length) await user.save();
    } catch(e) { console.log('Payment link on register:', e.message); }
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
    // Sync completed M-Pesa payments on login
    try {
      const Payment = require('../models/Payment');
      const phone = user.phone || '';
      if (phone) {
        const phone254 = phone.replace(/^0/, '254').replace(/^\+/, '');
        const phoneLocal = phone254.replace(/^254/, '0');
        const payments = await Payment.find({
          phone: { $in: [phone, phone254, phoneLocal] },
          status: 'completed', type: 'resource'
        });
        let changed = false;
        for (const p of payments) {
          if (p.resourceId) {
            const already = user.purchasedCourses.some(c => c.courseId?.toString() === p.resourceId.toString());
            if (!already) { user.purchasedCourses.push({ courseId: p.resourceId }); changed = true; }
          }
        }
        if (changed) await user.save();
      }
    } catch(e) { console.log('Payment sync on login:', e.message); }

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
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Sync any completed M-Pesa payments not yet linked to this account
    try {
      const Payment = require('../models/Payment');
      const phone = user.phone || '';
      if (phone) {
        const phone254 = phone.replace(/^0/, '254').replace(/^\+/, '');
        const phoneLocal = phone254.replace(/^254/, '0');
        const payments = await Payment.find({
          phone: { $in: [phone, phone254, phoneLocal] },
          status: 'completed',
          type: 'resource'
        });
        let changed = false;
        for (const p of payments) {
          if (p.resourceId) {
            const alreadyOwns = user.purchasedCourses.some(c => c.courseId?.toString() === p.resourceId.toString());
            if (!alreadyOwns) {
              user.purchasedCourses.push({ courseId: p.resourceId });
              changed = true;
            }
          }
        }
        if (changed) await user.save();
      }
    } catch(e) { console.log('Payment sync on /me:', e.message); }

    // Re-fetch with populated courses
    const populated = await User.findById(req.user.id)
      .populate('purchasedCourses.courseId', 'title category price thumbnail description')
      .select('-password');

    res.json({ success: true, user: populated });
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
    if (completed !== undefined) { course.completed = completed; if (completed) course.completedAt = course.completedAt || new Date(); }
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


// ── GOOGLE OAUTH ────────────────────────────────────────────────────────────
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'https://zeithzoom.com/api/auth/google/callback';

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      const name = profile.displayName;
      const avatar = profile.photos?.[0]?.value;
      const googleId = profile.id;

      if (!email) return done(null, false, { message: 'No email from Google' });

      let user = await User.findOne({ $or: [{ googleId }, { email }] });

      if (!user) {
        // New user — create account
        user = await User.create({
          name,
          email,
          googleId,
          avatar,
          password: require('bcryptjs').hashSync(require('crypto').randomBytes(20).toString('hex'), 10),
        });
      } else {
        // Existing user — update Google fields if missing
        if (!user.googleId) { user.googleId = googleId; await user.save(); }
      }

      // Sync any completed payments
      try {
        const Payment = require('../models/Payment');
        const phone = user.phone || '';
        if (phone) {
          const phone254 = phone.replace(/^0/, '254').replace(/^\+/, '');
          const phoneLocal = phone254.replace(/^254/, '0');
          const payments = await Payment.find({
            phone: { $in: [phone, phone254, phoneLocal] },
            status: 'completed', type: 'resource'
          });
          let changed = false;
          for (const p of payments) {
            if (p.resourceId) {
              const already = user.purchasedCourses.some(c => c.courseId?.toString() === p.resourceId.toString());
              if (!already) { user.purchasedCourses.push({ courseId: p.resourceId }); changed = true; }
            }
          }
          if (changed) await user.save();
        }
      } catch(e) { console.log('Payment sync on Google login:', e.message); }

      return done(null, user);
    } catch (err) {
      return done(err, null);
    }
  }));

  passport.serializeUser((user, done) => done(null, user._id));
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id).select('-password');
      done(null, user);
    } catch(err) { done(err, null); }
  });
}

// GET /api/auth/google — start OAuth flow
router.get('/google', (req, res, next) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.redirect('/login?msg=google-not-configured');
  }
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })(req, res, next);
});

// GET /api/auth/google/callback — OAuth callback
router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { failureRedirect: '/login?msg=google-failed' },
    async (err, user, info) => {
      if (err || !user) return res.redirect('/login?msg=google-failed');
      try {
        // Issue JWT token (same as email login)
        const token = makeToken(user);
        res.cookie('zz_token', token, {
          httpOnly: true,
          maxAge: 30 * 24 * 60 * 60 * 1000,
          sameSite: 'lax'
        });
        res.redirect('/dashboard');
      } catch(err) {
        res.redirect('/login?msg=google-failed');
      }
    }
  )(req, res, next);
});

module.exports = { router, authMiddleware };
