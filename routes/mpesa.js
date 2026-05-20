const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Payment = require('../models/Payment');
const Resource = require('../models/Resource');

// ─────────────────────────────────────────────
// KCB BUNI HELPERS
// ─────────────────────────────────────────────

function getBaseUrl() {
  return process.env.KCB_ENV === 'production'
    ? 'https://api.buni.kcbgroup.com'
    : 'https://uat.buni.kcbgroup.com';
}

function getTokenUrl() {
  return process.env.KCB_ENV === 'production'
    ? 'https://accounts.buni.kcbgroup.com/oauth2/token'
    : 'https://accounts.buni.kcbgroup.com/oauth2/token';
}

// Generate a Bearer access token from KCB BUNI
async function getAccessToken() {
  const { KCB_CONSUMER_KEY, KCB_CONSUMER_SECRET } = process.env;
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');

  const res = await axios.post(
    getTokenUrl(),
    params.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      auth: {
        username: KCB_CONSUMER_KEY,
        password: KCB_CONSUMER_SECRET
      }
    }
  );
  return res.data.access_token;
}

// Format phone to 2547XXXXXXXX
function formatPhone(phone) {
  let p = String(phone).replace(/\s+/g, '').replace(/[^0-9+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (!p.startsWith('254')) p = '254' + p;
  return p;
}

// Initiate KCB BUNI STK Push
async function stkPush({ phone, amount, invoiceNumber, description }) {
  const { KCB_CALLBACK_URL, KCB_SHORT_CODE } = process.env;

  const token = await getAccessToken();
  console.log('KCB token obtained successfully');

  const payload = {
    phoneNumber: formatPhone(phone),
    amount: String(Math.ceil(amount)),
    invoiceNumber: invoiceNumber || `ZZ-${Date.now()}`,
    sharedShortCode: true,
    orgShortCode: KCB_SHORT_CODE || '8081055',
    callbackUrl: KCB_CALLBACK_URL,
    transactionDescription: description || 'Zenith Zoom Payment'
  };
  console.log('STK Push payload:', JSON.stringify(payload));

  const response = await axios.post(
    `${getBaseUrl()}/mm/api/request/1.0.0/stkpush`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

// POST /api/mpesa/pay-resource
router.post('/pay-resource', async (req, res) => {
  try {
    const { phone, resourceId } = req.body;
    if (!phone || !resourceId)
      return res.status(400).json({ success: false, message: 'Phone and resource ID required' });

    const resource = await Resource.findById(resourceId);
    if (!resource)
      return res.status(404).json({ success: false, message: 'Resource not found' });

    const invoiceNumber = `ZZ-RES-${resourceId.toString().slice(-6).toUpperCase()}`;
    const stkRes = await stkPush({
      phone,
      amount: resource.price,
      invoiceNumber,
      description: `ZenithZoom: ${resource.title.slice(0, 30)}`
    });

    // KCB returns ResponseCode "0" for success
    const resCode = stkRes?.response?.ResponseCode ?? stkRes?.header?.statusCode;
    if (resCode !== '0') {
      const msg = stkRes?.response?.ResponseDescription
        || stkRes?.header?.statusDescription
        || 'STK Push failed';
      return res.status(400).json({ success: false, message: msg });
    }

    const checkoutRequestId = stkRes.response.CheckoutRequestID;
    const merchantRequestId = stkRes.response.MerchantRequestID;

    await Payment.create({
      checkoutRequestId,
      merchantRequestId,
      phone: formatPhone(phone),
      amount: resource.price,
      type: 'resource',
      resourceId: resource._id
    });

    res.json({
      success: true,
      checkoutRequestId,
      message: 'STK Push sent. Enter your M-Pesa PIN on your phone.'
    });
  } catch (err) {
    console.error('KCB STK Push (resource) error:', err.response?.data || err.message);
    res.status(500).json({ success: false, message: 'Payment initiation failed. Try again.' });
  }
});

// POST /api/mpesa/pay-cv
router.post('/pay-cv', async (req, res) => {
  try {
    const { phone, cvData } = req.body;
    if (!phone || !cvData)
      return res.status(400).json({ success: false, message: 'Phone and CV data required' });

    const amount = 100; // KES 100 for CV export
    const invoiceNumber = `ZZ-CV-${Date.now()}`;

    const stkRes = await stkPush({
      phone,
      amount,
      invoiceNumber,
      description: 'ZenithZoom CV Builder'
    });

    const resCode = stkRes?.response?.ResponseCode ?? stkRes?.header?.statusCode;
    if (resCode !== '0') {
      const msg = stkRes?.response?.ResponseDescription
        || stkRes?.header?.statusDescription
        || 'STK Push failed';
      return res.status(400).json({ success: false, message: msg });
    }

    const checkoutRequestId = stkRes.response.CheckoutRequestID;
    const merchantRequestId = stkRes.response.MerchantRequestID;

    await Payment.create({
      checkoutRequestId,
      merchantRequestId,
      phone: formatPhone(phone),
      amount,
      type: 'cv',
      cvData
    });

    res.json({
      success: true,
      checkoutRequestId,
      message: 'STK Push sent. Enter your M-Pesa PIN on your phone.'
    });
  } catch (err) {
    console.error('KCB STK Push (CV) error:', err.response?.data || err.message);
    res.status(500).json({ success: false, message: 'Payment initiation failed. Try again.' });
  }
});

// POST /api/mpesa/callback  — KCB BUNI calls this after payment
router.post('/callback', async (req, res) => {
  try {
    console.log('KCB BUNI callback received:', JSON.stringify(req.body, null, 2));

    // KCB callback body structure:
    // { Body: { stkCallback: { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } } }
    // (mirrors Safaricom format — KCB tunnels through Safaricom M-Pesa)
    const callback = req.body?.Body?.stkCallback;
    if (!callback) {
      // Some KCB sandbox versions send a flat payload
      const flat = req.body;
      if (flat?.CheckoutRequestID) {
        await processCallback(flat.CheckoutRequestID, flat.ResultCode, flat.CallbackMetadata);
      }
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const { CheckoutRequestID, ResultCode, CallbackMetadata } = callback;
    await processCallback(CheckoutRequestID, ResultCode, CallbackMetadata);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error('Callback processing error:', err);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' }); // Always ACK KCB
  }
});

async function processCallback(checkoutRequestId, resultCode, callbackMetadata) {
  const payment = await Payment.findOne({ checkoutRequestId });
  if (!payment) {
    console.warn('Payment not found for CheckoutRequestID:', checkoutRequestId);
    return;
  }

  if (String(resultCode) === '0') {
    // Payment successful
    const items = callbackMetadata?.Item || [];
    const receipt = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;

    const downloadToken = uuidv4();
    const downloadExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    payment.status = 'completed';
    payment.mpesaReceiptNumber = receipt || null;
    payment.downloadToken = downloadToken;
    payment.downloadExpiry = downloadExpiry;
    payment.updatedAt = new Date();

    if (payment.type === 'resource' && payment.resourceId) {
      await Resource.findByIdAndUpdate(payment.resourceId, { $inc: { downloads: 1 } });
    }
  } else {
    payment.status = 'failed';
    payment.updatedAt = new Date();
  }

  await payment.save();
}

// GET /api/mpesa/status/:checkoutRequestId — polled by the frontend
router.get('/status/:checkoutRequestId', async (req, res) => {
  try {
    const payment = await Payment.findOne({ checkoutRequestId: req.params.checkoutRequestId });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    res.json({
      success: true,
      status: payment.status,
      downloadToken: payment.status === 'completed' ? payment.downloadToken : null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error checking payment status' });
  }
});

// GET /api/mpesa/download/:token — serve file after verified payment
router.get('/download/:token', async (req, res) => {
  try {
    const payment = await Payment.findOne({
      downloadToken: req.params.token,
      status: 'completed',
      downloadExpiry: { $gt: new Date() }
    }).populate('resourceId');

    if (!payment)
      return res.status(403).send('Invalid or expired download link. Please complete payment again.');

    if (payment.type === 'resource') {
      const resource = payment.resourceId;
      if (!resource) return res.status(404).send('Resource not found.');
      return res.download(resource.filePath, resource.fileName);
    }

    if (payment.type === 'cv') {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ margin: 50 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="ZenithZoom-CV.pdf"');
      doc.pipe(res);
      generateCVPDF(doc, payment.cvData);
      doc.end();
    }
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).send('Download failed. Please contact support.');
  }
});

// ─────────────────────────────────────────────
// CV PDF GENERATOR
// ─────────────────────────────────────────────
function generateCVPDF(doc, cv) {
  const teal = '#00C2D4';
  const dark = '#070B14';
  const pageW = doc.page.width;

  // Header band
  doc.rect(0, 0, pageW, 130).fill(dark);

  doc.fillColor('white')
    .font('Helvetica-Bold')
    .fontSize(26)
    .text(cv.fullName || 'Your Name', 50, 36);

  doc.fillColor(teal)
    .font('Helvetica')
    .fontSize(13)
    .text(cv.jobTitle || '', 50, 68);

  const contactParts = [cv.email, cv.phone, cv.location, cv.linkedin].filter(Boolean);
  doc.fillColor('#aaaaaa')
    .fontSize(9)
    .text(contactParts.join('  |  '), 50, 90, { width: pageW - 100 });

  doc.moveDown(4.5);

  const sectionHeader = (title) => {
    doc.moveDown(0.8)
      .fillColor(teal)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(title.toUpperCase(), { characterSpacing: 1.5 });
    doc.moveTo(50, doc.y + 2).lineTo(pageW - 50, doc.y + 2)
      .strokeColor(teal).lineWidth(0.8).stroke();
    doc.moveDown(0.5);
  };

  if (cv.summary) {
    sectionHeader('Professional Summary');
    doc.fillColor('#333333').font('Helvetica').fontSize(10)
      .text(cv.summary, { align: 'justify', lineGap: 2 });
  }

  if (cv.experience?.length) {
    sectionHeader('Work Experience');
    cv.experience.forEach(exp => {
      if (!exp.role) return;
      doc.fillColor(dark).font('Helvetica-Bold').fontSize(10.5)
        .text(`${exp.role}`, { continued: true })
        .font('Helvetica').fillColor('#555555')
        .text(`   —   ${exp.company}`);
      doc.fillColor('#888888').fontSize(8.5)
        .text(`${exp.startDate || ''}${exp.endDate ? ' – ' + exp.endDate : ''}${exp.location ? '   ·   ' + exp.location : ''}`);
      if (exp.description) {
        doc.fillColor('#444444').fontSize(9.5).text(exp.description, { indent: 12, lineGap: 1.5 });
      }
      doc.moveDown(0.5);
    });
  }

  if (cv.education?.length) {
    sectionHeader('Education');
    cv.education.forEach(edu => {
      if (!edu.degree) return;
      doc.fillColor(dark).font('Helvetica-Bold').fontSize(10.5)
        .text(`${edu.degree}`, { continued: true })
        .font('Helvetica').fillColor('#555555')
        .text(`   —   ${edu.institution}`);
      doc.fillColor('#888888').fontSize(8.5)
        .text(`${edu.startYear || ''}${edu.endYear ? ' – ' + edu.endYear : ''}`);
      doc.moveDown(0.4);
    });
  }

  if (cv.skills) {
    sectionHeader('Skills');
    doc.fillColor('#333333').font('Helvetica').fontSize(10).text(cv.skills);
  }

  if (cv.certifications) {
    sectionHeader('Certifications & Achievements');
    doc.fillColor('#333333').font('Helvetica').fontSize(10).text(cv.certifications);
  }

  if (cv.languages) {
    sectionHeader('Languages');
    doc.fillColor('#333333').font('Helvetica').fontSize(10).text(cv.languages);
  }

  // Footer
  const footerY = doc.page.height - 36;
  doc.rect(0, footerY - 10, pageW, 46).fill(dark);
  doc.fillColor(teal).fontSize(8).font('Helvetica')
    .text('Generated by Zenith Zoom  ·  zenithzoom.com', 50, footerY, { align: 'center' });
}

module.exports = router;
