const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Payment = require('../models/Payment');
const Resource = require('../models/Resource');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  consumerKey:    process.env.KCB_CONSUMER_KEY    || 'fp0Me33xpYF500M6Nmxsi30UZB8a',
  consumerSecret: process.env.KCB_CONSUMER_SECRET || 'tohCNrzsnC3KdU9u4OFZuTTnf8Aa',
  orgShortCode:   process.env.KCB_ORG_SHORT_CODE  || '174379',
  passKey:        process.env.KCB_PASS_KEY        || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
  callbackUrl:    process.env.KCB_CALLBACK_URL    || 'https://zeithzoom.com/api/mpesa/callback',
  baseUrl:        'https://api.buni.kcbgroup.com',
  tokenUrl:       'https://api.buni.kcbgroup.com/token',
  stkUrl:         'https://api.buni.kcbgroup.com/mm/api/request/1.0.0/stkpush',
};

// Token cache
let _token = null;
let _tokenExpiry = 0;

// ── HELPERS ───────────────────────────────────────────────────────────────────
function formatPhone(phone) {
  let p = String(phone).replace(/\s+/g, '').replace(/[^0-9]/g, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (!p.startsWith('254')) p = '254' + p;
  return p;
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) {
    console.log('[KCB] Using cached token');
    return _token;
  }

  const auth = Buffer.from(`${CONFIG.consumerKey}:${CONFIG.consumerSecret}`).toString('base64');
  console.log('[KCB] TOKEN REQUEST:', CONFIG.tokenUrl);
  console.log('[KCB] Consumer key:', CONFIG.consumerKey.slice(0,8)+'...');

  try {
    const res = await axios.post(
      CONFIG.tokenUrl,
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000
      }
    );
    _token = res.data.access_token;
    _tokenExpiry = Date.now() + 55 * 60 * 1000;
    console.log('[KCB] Token obtained ✅ preview:', _token.slice(0,20));
    return _token;
  } catch (tokenErr) {
    console.error('[KCB] TOKEN FAILED:', tokenErr.response?.status, JSON.stringify(tokenErr.response?.data));
    throw tokenErr;
  }
}

async function stkPush({ phone, amount, invoiceNumber, description }) {
  const token = await getToken();
  const sec = Math.floor(Date.now() / 1000);
  const msgId = `${sec}_KCBOrg_${sec}`;

  const payload = {
    phoneNumber:            formatPhone(phone),
    amount:                 String(Math.round(Number(amount))),
    invoiceNumber:          String(invoiceNumber || `ZZ${sec}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 18),
    sharedShortCode:        true,
    orgShortCode:           CONFIG.orgShortCode,
    orgPassKey:             CONFIG.passKey,
    callbackUrl:            CONFIG.callbackUrl,
    transactionDescription: String(description || 'Zenith Zoom Payment').slice(0, 50),
  };

  console.log('[KCB] === STK PUSH REQUEST ===');
  console.log('[KCB] URL:', CONFIG.stkUrl);
  console.log('[KCB] Payload:', JSON.stringify(payload));
  console.log('[KCB] Token preview:', token.slice(0,20));
  console.log('[KCB] messageId:', msgId);

  const response = await axios.post(CONFIG.stkUrl, payload, {
    headers: {
      'Authorization':   `Bearer ${token}`,
      'Content-Type':    'application/json',
      'Accept':          'application/json',
      'routeCode':       '207',
      'operation':       'STKPush',
      'messageId':       msgId,
      'X-IBM-Client-Id': CONFIG.consumerKey,
    },
    timeout: 30000
  });

  console.log('[KCB] STK response:', JSON.stringify(response.data));
  return response.data;
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

// POST /api/mpesa/pay-resource
router.post('/pay-resource', async (req, res) => {
  try {
    const { phone, resourceId } = req.body;
    if (!phone || !resourceId)
      return res.status(400).json({ success: false, message: 'Phone and resource ID required' });
    if (!/^[a-fA-F0-9]{24}$/.test(resourceId))
      return res.status(400).json({ success: false, message: 'Invalid resource ID' });

    const resource = await Resource.findById(resourceId);
    if (!resource)
      return res.status(404).json({ success: false, message: 'Resource not found' });

    const invoiceNumber = `ZZRES${resourceId.toString().slice(-6).toUpperCase()}`;
    const stkRes = await stkPush({
      phone,
      amount: resource.price,
      invoiceNumber,
      description: `ZenithZoom: ${resource.title.slice(0, 30)}`
    });

    // KCB response format: { header: { statusCode: "1", statusDescription: "Success" }, response: {...} }
    console.log('[KCB] Full STK response:', JSON.stringify(stkRes));
    const statusCode = String(stkRes?.header?.statusCode || '');
    const statusDesc = stkRes?.header?.statusDescription || '';
    console.log('[KCB] statusCode:', statusCode, '| desc:', statusDesc);

    // statusCode "1" = API accepted the request (success)
    // statusCode "0" = API rejected the request (failure)
    // "Duplicated MSISDN" with statusCode "1" = STK already sent, treat as success
    if (statusCode === '0') {
      console.error('[KCB] STK rejected:', statusDesc);
      return res.status(400).json({ success: false, message: statusDesc || 'STK Push failed' });
    }

    // Extract checkout IDs
    const responseBody = typeof stkRes?.response === 'object' ? stkRes.response : {};
    const checkoutRequestId = responseBody?.CheckoutRequestID || responseBody?.checkoutRequestId || `ZZ-${Date.now()}`;
    const merchantRequestId = responseBody?.MerchantRequestID || responseBody?.merchantRequestId || null;

    await Payment.create({
      checkoutRequestId,
      merchantRequestId,
      phone: formatPhone(phone),
      amount: resource.price,
      type: 'resource',
      resourceId: resource._id
    });

    res.json({ success: true, checkoutRequestId, message: 'STK Push sent. Enter your M-Pesa PIN.' });
  } catch (err) {
    const status = err.response?.status;
    const data   = err.response?.data;
    const msg    = data?.message || data?.error || err.message;
    console.error('[KCB] pay-resource error:', status, JSON.stringify(data));
    _token = null; _tokenExpiry = 0; // reset token on error

    let userMsg = msg || 'Payment initiation failed. Try again.';
    if (status === 403) userMsg = `KCB 403 Forbidden - URL: ${CONFIG.stkUrl}`;
    if (status === 401) userMsg = 'KCB 401 - Token invalid';
    console.error('[KCB] === FULL ERROR ===');
    console.error('[KCB] Status:', status);
    console.error('[KCB] Data:', JSON.stringify(data));
    console.error('[KCB] Headers sent:', JSON.stringify(err.config?.headers));
    console.error('[KCB] URL called:', err.config?.url);
    res.status(500).json({ success: false, message: userMsg, _debug: { status, data, url: err.config?.url } });
  }
});

// POST /api/mpesa/pay-cv
router.post('/pay-cv', async (req, res) => {
  try {
    const { phone, cvData } = req.body;
    if (!phone || !cvData)
      return res.status(400).json({ success: false, message: 'Phone and CV data required' });

    const amount = parseInt(process.env.CV_PRICE || '100');
    const invoiceNumber = `ZZCV${Date.now().toString().slice(-8)}`;

    const stkRes = await stkPush({ phone, amount, invoiceNumber, description: 'ZenithZoom CV Builder' });

    const statusCode = String(stkRes?.header?.statusCode || '');
    if (statusCode === '0') {
      return res.status(400).json({ success: false, message: stkRes?.header?.statusDescription || 'STK Push failed' });
    }
    const responseBody = typeof stkRes?.response === 'object' ? stkRes.response : {};
    const checkoutRequestId = responseBody?.CheckoutRequestID || responseBody?.checkoutRequestId || `ZZCV-${Date.now()}`;
    const merchantRequestId = responseBody?.MerchantRequestID || responseBody?.merchantRequestId || null;

    await Payment.create({ checkoutRequestId, merchantRequestId, phone: formatPhone(phone), amount, type: 'cv', cvData });
    res.json({ success: true, checkoutRequestId, message: 'STK Push sent. Enter your M-Pesa PIN.' });
  } catch (err) {
    const status = err.response?.status;
    const data   = err.response?.data;
    _token = null; _tokenExpiry = 0;
    console.error('[KCB] pay-cv error:', status, JSON.stringify(data));
    res.status(500).json({ success: false, message: data?.message || err.message || 'Payment failed.' });
  }
});

// POST /api/mpesa/callback
router.post('/callback', async (req, res) => {
  try {
    console.log('[KCB] Callback:', JSON.stringify(req.body, null, 2));
    // KCB callback format - may be Safaricom-style or KCB-style
    const body = req.body;
    const cb = body?.Body?.stkCallback || body?.stkCallback || body;
    const checkoutRequestId = cb?.CheckoutRequestID || cb?.checkoutRequestId || body?.CheckoutRequestID;
    const resultCode = cb?.ResultCode ?? cb?.resultCode ?? body?.ResultCode;
    const metadata  = cb?.CallbackMetadata || body?.CallbackMetadata;

    if (!checkoutRequestId) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    const payment = await Payment.findOne({ checkoutRequestId });
    if (!payment) { console.warn('[KCB] Payment not found:', checkoutRequestId); return res.json({ ResultCode: 0, ResultDesc: 'Accepted' }); }

    if (String(resultCode) === '0') {
      const items   = metadata?.Item || [];
      const receipt = items.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      payment.status              = 'completed';
      payment.mpesaReceiptNumber  = receipt || null;
      payment.downloadToken       = uuidv4();
      payment.downloadExpiry      = new Date(Date.now() + 24 * 60 * 60 * 1000);

      if (payment.type === 'resource' && payment.resourceId) {
        await Resource.findByIdAndUpdate(payment.resourceId, { $inc: { downloads: 1 } });
        try {
          const User = require('../models/User');
          const raw = payment.phone || '';
          const p254 = raw.startsWith('0') ? '254' + raw.slice(1) : raw;
          const p0   = raw.startsWith('254') ? '0' + raw.slice(3) : raw;
          const user = await User.findOne({ $or: [{ phone: raw }, { phone: p254 }, { phone: p0 }] });
          if (user) {
            const already = user.purchasedCourses.some(c => c.courseId?.toString() === payment.resourceId.toString());
            if (!already) { user.purchasedCourses.push({ courseId: payment.resourceId }); await user.save(); }
            console.log('[KCB] Course linked to:', user.email);
          }
        } catch(e) { console.log('[KCB] User link error:', e.message); }
      }
    } else {
      payment.status = 'failed';
    }

    await payment.save();
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error('[KCB] Callback error:', err);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

// GET /api/mpesa/status/:id
router.get('/status/:checkoutRequestId', async (req, res) => {
  try {
    const id = req.params.checkoutRequestId;
    const payment = await Payment.findOne({ $or: [{ checkoutRequestId: id }, { merchantRequestId: id }] });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    res.json({ success: true, status: payment.status, downloadToken: payment.status === 'completed' ? payment.downloadToken : null });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error checking status' });
  }
});

// GET /api/mpesa/download/:token
router.get('/download/:token', async (req, res) => {
  try {
    const payment = await Payment.findOne({
      downloadToken: req.params.token,
      status: 'completed',
      downloadExpiry: { $gt: new Date() }
    }).populate('resourceId');

    if (!payment) return res.status(403).send('Invalid or expired download link.');

    if (payment.type === 'resource') {
      const resource = payment.resourceId;
      if (!resource) return res.status(404).send('Resource not found.');
      if (resource.filePath?.startsWith('http')) {
        const cloudinary = require('cloudinary').v2;
        cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
        const url = cloudinary.utils.private_download_url(resource.cloudinaryId, 'pdf', { resource_type: 'raw', type: 'upload', expires_at: Math.floor(Date.now() / 1000) + 3600 });
        return res.redirect(url);
      }
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
    res.status(500).send('Download failed.');
  }
});

// GET /api/mpesa/test-connection
router.get('/test-connection', async (req, res) => {
  try {
    const token = await getToken();
    res.json({ success: true, message: 'KCB BUNI ✅', config: { baseUrl: CONFIG.baseUrl, stkUrl: CONFIG.stkUrl, orgShortCode: CONFIG.orgShortCode, callbackUrl: CONFIG.callbackUrl, consumerKey: CONFIG.consumerKey.slice(0,8)+'...', tokenPreview: token.slice(0,20)+'...' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.response?.data || err.message, status: err.response?.status });
  }
});

// GET /api/mpesa/test-stk?phone=0716762062
router.get('/test-stk', async (req, res) => {
  try {
    const phone = req.query.phone || '0716762062';
    console.log('[KCB] Test STK Push to:', phone);
    const result = await stkPush({
      phone,
      amount: 1,
      invoiceNumber: `ZZTEST${Date.now().toString().slice(-6)}`,
      description: 'ZenithZoom Test'
    });
    res.json({ success: true, result });
  } catch (err) {
    const errData = err.response?.data;
    const errStatus = err.response?.status;
    res.json({
      success: false,
      status: errStatus,
      error: errData || err.message,
      url: err.config?.url,
      sentHeaders: err.config?.headers
    });
  }
});

// ── CV PDF ────────────────────────────────────────────────────────────────────
function generateCVPDF(doc, cv) {
  const teal = '#00C2D4', dark = '#070B14', pageW = doc.page.width;
  doc.rect(0, 0, pageW, 130).fill(dark);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(26).text(cv.fullName || 'Your Name', 50, 36);
  doc.fillColor(teal).font('Helvetica').fontSize(13).text(cv.jobTitle || '', 50, 68);
  doc.fillColor('#aaaaaa').fontSize(9).text([cv.email, cv.phone, cv.location, cv.linkedin].filter(Boolean).join('  |  '), 50, 90, { width: pageW - 100 });
  doc.moveDown(4.5);
  const sh = (t) => { doc.moveDown(0.8).fillColor(teal).font('Helvetica-Bold').fontSize(10).text(t.toUpperCase(), { characterSpacing: 1.5 }); doc.moveTo(50, doc.y+2).lineTo(pageW-50, doc.y+2).strokeColor(teal).lineWidth(0.8).stroke(); doc.moveDown(0.5); };
  if (cv.summary) { sh('Professional Summary'); doc.fillColor('#333333').font('Helvetica').fontSize(10).text(cv.summary, { align: 'justify', lineGap: 2 }); }
  if (cv.experience?.length) { sh('Work Experience'); cv.experience.forEach(e => { if (!e.role) return; doc.fillColor(dark).font('Helvetica-Bold').fontSize(10.5).text(e.role, { continued: true }).font('Helvetica').fillColor('#555555').text(`   —   ${e.company}`); doc.fillColor('#888888').fontSize(8.5).text(`${e.startDate||''}${e.endDate?' – '+e.endDate:''}${e.location?'   ·   '+e.location:''}`); if (e.description) doc.fillColor('#444444').fontSize(9.5).text(e.description, { indent: 12, lineGap: 1.5 }); doc.moveDown(0.5); }); }
  if (cv.education?.length) { sh('Education'); cv.education.forEach(e => { if (!e.degree) return; doc.fillColor(dark).font('Helvetica-Bold').fontSize(10.5).text(e.degree, { continued: true }).font('Helvetica').fillColor('#555555').text(`   —   ${e.institution}`); doc.fillColor('#888888').fontSize(8.5).text(`${e.startYear||''}${e.endYear?' – '+e.endYear:''}`); doc.moveDown(0.4); }); }
  if (cv.skills) { sh('Skills'); doc.fillColor('#333333').font('Helvetica').fontSize(10).text(cv.skills); }
  if (cv.certifications) { sh('Certifications'); doc.fillColor('#333333').font('Helvetica').fontSize(10).text(cv.certifications); }
  if (cv.languages) { sh('Languages'); doc.fillColor('#333333').font('Helvetica').fontSize(10).text(cv.languages); }
  const fy = doc.page.height - 36;
  doc.rect(0, fy-10, pageW, 46).fill(dark);
  doc.fillColor(teal).fontSize(8).font('Helvetica').text('Generated by Zenith Zoom  ·  zenithzoom.com', 50, fy, { align: 'center' });
}

module.exports = router;
