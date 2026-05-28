const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const Assignment = require('../models/Assignment');
const User = require('../models/User');
const { Resource } = require('../models');

const JWT_SECRET = process.env.SESSION_SECRET || 'zenithzoom-secret';

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.cookies?.zz_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, message: 'Not authenticated' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ success: false, message: 'Invalid token' }); }
}

// Admin middleware
const { requireAdmin } = require('../middleware/auth');

// Multer — accept PDF and DOCX
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/assignments');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}_${file.originalname.replace(/\s/g, '_')}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF and DOCX files are allowed'));
  },
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

// ── POST /api/assignments/submit ─────────────────────────────────────────────
router.post('/submit', authMiddleware, upload.single('assignment'), async (req, res) => {
  try {
    const { courseId } = req.body;
    if (!courseId) return res.status(400).json({ success: false, message: 'courseId required' });
    if (!req.file)  return res.status(400).json({ success: false, message: 'File required' });

    // Check user owns the course
    const user = await User.findById(req.user.id);
    const owned = user.purchasedCourses.find(c => c.courseId.toString() === courseId);
    if (!owned) return res.status(403).json({ success: false, message: 'You have not purchased this course' });

    // Check not already approved
    const existing = await Assignment.findOne({ userId: req.user.id, courseId, status: 'approved' });
    if (existing) return res.status(400).json({ success: false, message: 'Assignment already approved for this course' });

    // Delete previous pending submission if any
    const prev = await Assignment.findOne({ userId: req.user.id, courseId, status: 'pending' });
    if (prev) {
      try { fs.unlinkSync(prev.filePath); } catch {}
      await prev.deleteOne();
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const assignment = await Assignment.create({
      userId: req.user.id,
      courseId,
      fileName: req.file.filename,
      fileOriginalName: req.file.originalname,
      filePath: req.file.path,
      fileType: ext === '.pdf' ? 'pdf' : 'docx',
      fileSize: req.file.size,
      status: 'pending'
    });

    res.json({ success: true, message: 'Assignment submitted successfully! Your tutor will review it soon.', assignmentId: assignment._id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/assignments/my ───────────────────────────────────────────────────
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const assignments = await Assignment.find({ userId: req.user.id })
      .populate('courseId', 'title category')
      .sort({ submittedAt: -1 });
    res.json({ success: true, assignments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/assignments/all (admin) ─────────────────────────────────────────
router.get('/all', requireAdmin, async (req, res) => {
  try {
    const assignments = await Assignment.find()
      .populate('userId', 'name email')
      .populate('courseId', 'title category')
      .sort({ submittedAt: -1 });
    res.json({ success: true, assignments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/assignments/download/:id (admin) ────────────────────────────────
router.get('/download/:id', requireAdmin, async (req, res) => {
  try {
    const a = await Assignment.findById(req.params.id);
    if (!a) return res.status(404).json({ success: false, message: 'Not found' });
    if (!fs.existsSync(a.filePath)) return res.status(404).json({ success: false, message: 'File missing' });
    res.download(a.filePath, a.fileOriginalName);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PATCH /api/assignments/:id/review (admin) ────────────────────────────────
router.patch('/:id/review', requireAdmin, async (req, res) => {
  try {
    const { status, tutorNote } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be approved or rejected' });
    }

    const a = await Assignment.findById(req.params.id).populate('userId').populate('courseId');
    if (!a) return res.status(404).json({ success: false, message: 'Assignment not found' });

    a.status = status;
    a.tutorNote = tutorNote || '';
    a.reviewedAt = new Date();
    a.reviewedBy = 'Tutor';
    await a.save();

    // If approved → mark course as completed and set completedAt
    if (status === 'approved') {
      const user = await User.findById(a.userId._id || a.userId);
      const course = user.purchasedCourses.find(c => c.courseId.toString() === a.courseId._id.toString());
      if (course) {
        course.completed = true;
        course.completedAt = course.completedAt || new Date();
        course.progress = 100;
        await user.save();
      }
    }

    res.json({ success: true, message: `Assignment ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
