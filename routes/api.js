const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { Resource, Payment, Job } = require('../models');
const { initiateStkPush } = require('../utils/mpesa');
const { generateCVPdf } = require('../utils/cvGenerator');
const { requireAdmin } = require('../middleware/auth');

// Multer setup for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/resources');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}_${file.originalname}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ─── ADMIN AUTH ───────────────────────────────────────────────────────────────
router.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

router.post('/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get('/admin/status', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

// ─── RESOURCES (PDFs) ─────────────────────────────────────────────────────────
router.get('/resources', async (req, res) => {
  try {
    const resources = await Resource.find({}, '-filepath');
    res.json(resources);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/resources', requireAdmin, upload.single('pdf'), async (req, res) => {
  try {
    const { title, description, category, price } = req.body;
    if (!req.file) return res.status(400).json({ error: 'PDF file required' });

    const resource = new Resource({
      title,
      description,
      category: category || 'General',
      price: parseFloat(price) || 100,
      filename: req.file.originalname,
      filepath: req.file.path
    });
    await resource.save();
    res.json({ success: true, resource });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/admin/resources/:id', requireAdmin, async (req, res) => {
  try {
    const resource = await Resource.findByIdAndDelete(req.params.id);
    if (resource && fs.existsSync(resource.filepath)) {
      fs.unlinkSync(resource.filepath);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── JOBS ─────────────────────────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const { category, type, search } = req.query;
    let query = { isActive: true };
    if (category) query.category = category;
    if (type) query.type = type;
    if (search) query.$or = [
      { title: new RegExp(search, 'i') },
      { company: new RegExp(search, 'i') },
      { description: new RegExp(search, 'i') }
    ];
    const jobs = await Job.find(query).sort({ createdAt: -1 });
    res.json(jobs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/jobs/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/jobs', requireAdmin, async (req, res) => {
  try {
    const job = new Job(req.body);
    await job.save();
    res.json({ success: true, job });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/jobs/:id', requireAdmin, async (req, res) => {
  try {
    const job = await Job.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, job });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/admin/jobs/:id', requireAdmin, async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── M-PESA PAYMENTS ──────────────────────────────────────────────────────────
router.post('/mpesa/initiate-pdf', async (req, res) => {
  try {
    const { phone, resourceId } = req.body;
    if (!phone || !resourceId) return res.status(400).json({ error: 'Phone and resourceId required' });

    const resource = await Resource.findById(resourceId);
    if (!resource) return res.status(404).json({ error: 'Resource not found' });

    const stkResponse = await initiateStkPush({
      phone,
      amount: resource.price,
      accountRef: `PDF-${resource._id.toString().slice(-6)}`,
      description: `Zenith Zoom: ${resource.title}`
    });

    if (stkResponse.ResponseCode !== '0') {
      return res.status(400).json({ error: 'STK push failed', details: stkResponse });
    }

    const payment = new Payment({
      phone,
      amount: resource.price,
      resourceId: resource._id,
      type: 'pdf',
      checkoutRequestId: stkResponse.CheckoutRequestID,
      merchantRequestId: stkResponse.MerchantRequestID
    });
    await payment.save();

    res.json({
      success: true,
      paymentId: payment._id,
      checkoutRequestId: stkResponse.CheckoutRequestID,
      message: 'STK push sent. Enter M-Pesa PIN to complete payment.'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/mpesa/initiate-cv', async (req, res) => {
  try {
    const { phone, cvData } = req.body;
    if (!phone || !cvData) return res.status(400).json({ error: 'Phone and CV data required' });

    const amount = 150;
    const stkResponse = await initiateStkPush({
      phone,
      amount,
      accountRef: 'ZENITH-CV',
      description: 'Zenith Zoom: CV Download'
    });

    if (stkResponse.ResponseCode !== '0') {
      return res.status(400).json({ error: 'STK push failed', details: stkResponse });
    }

    const payment = new Payment({
      phone,
      amount,
      type: 'cv',
      checkoutRequestId: stkResponse.CheckoutRequestID,
      merchantRequestId: stkResponse.MerchantRequestID,
      cvData
    });
    await payment.save();

    res.json({
      success: true,
      paymentId: payment._id,
      checkoutRequestId: stkResponse.CheckoutRequestID,
      message: 'STK push sent. Enter M-Pesa PIN to complete payment.'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// M-Pesa Callback
router.post('/mpesa/callback', async (req, res) => {
  try {
    const callback = req.body.Body?.stkCallback;
    if (!callback) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    const { MerchantRequestID, CheckoutRequestID, ResultCode, CallbackMetadata } = callback;

    const payment = await Payment.findOne({ checkoutRequestId: CheckoutRequestID });
    if (!payment) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    if (ResultCode === 0) {
      const items = CallbackMetadata?.Item || [];
      const receipt = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;

      payment.status = 'completed';
      payment.mpesaReceiptNumber = receipt;
      payment.completedAt = new Date();
      await payment.save();

      if (payment.type === 'pdf') {
        await Resource.findByIdAndUpdate(payment.resourceId, { $inc: { downloads: 1 } });
      }
    } else {
      payment.status = 'failed';
      await payment.save();
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (e) {
    console.error('Callback error:', e);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

// Payment status polling
router.get('/mpesa/status/:paymentId', async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json({ status: payment.status, type: payment.type });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download PDF after payment
router.get('/download/pdf/:paymentId', async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId).populate('resourceId');
    if (!payment || payment.status !== 'completed') {
      return res.status(403).json({ error: 'Payment not completed' });
    }
    if (payment.type !== 'pdf') return res.status(400).json({ error: 'Invalid payment type' });

    const resource = payment.resourceId;
    if (!resource || !fs.existsSync(resource.filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.download(resource.filepath, resource.filename);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download CV after payment
router.get('/download/cv/:paymentId', async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId);
    if (!payment || payment.status !== 'completed') {
      return res.status(403).json({ error: 'Payment not completed' });
    }
    if (payment.type !== 'cv') return res.status(400).json({ error: 'Invalid payment type' });

    const pdfBuffer = await generateCVPdf(payment.cvData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${payment.cvData.fullName?.replace(/\s+/g,'_')}_CV.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: Get all payments
router.get('/admin/payments', requireAdmin, async (req, res) => {
  try {
    const payments = await Payment.find().populate('resourceId', 'title').sort({ createdAt: -1 }).limit(100);
    res.json(payments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
