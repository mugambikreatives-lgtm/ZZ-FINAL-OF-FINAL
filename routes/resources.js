const express = require('express');
const router = express.Router();
const multer = require('multer');
const Resource = require('../models/Resource');
const { isAdminAPI } = require('../middleware/auth');

// Lazy Cloudinary setup — only initialised when admin uploads a file
function getCloudinaryStorage() {
  const cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  const { CloudinaryStorage } = require('multer-storage-cloudinary');
  return new CloudinaryStorage({
    cloudinary,
    params: {
      folder: 'zenithzoom-courses',
      resource_type: 'raw',
      format: 'pdf',
      use_filename: true,
      unique_filename: true,
      access_mode: 'public',
      type: 'upload',
    },
  });
}

function getUpload() {
  return multer({
    storage: getCloudinaryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype === 'application/pdf') cb(null, true);
      else cb(new Error('Only PDF files allowed'), false);
    },
  });
}

// GET all resources (public)
router.get('/', async (req, res) => {
  // Set a hard response timeout of 9 seconds
  const timeout = setTimeout(() => {
    if (!res.headersSent) res.status(503).json({ success: false, message: 'Request timed out — database is slow. Please retry.' });
  }, 9000);

  const mongoose = require('mongoose');
  if (mongoose.connection.readyState !== 1) {
    clearTimeout(timeout);
    return res.status(503).json({ success: false, message: 'Database not connected. Check MONGODB_URI env var on Hostinger.' });
  }
  try {
    const { category, search } = req.query;
    let query = { isActive: { $ne: false } };
    if (category) query.category = category;
    if (search) query.$or = [
      { title: new RegExp(search, 'i') },
      { description: new RegExp(search, 'i') }
    ];
    const resources = await Resource.find(query).select('-filePath').sort('-createdAt').maxTimeMS(8000);
    clearTimeout(timeout);
    if (!res.headersSent) res.json({ success: true, resources });
  } catch (err) {
    clearTimeout(timeout);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Error fetching resources: ' + err.message });
  }
});

// POST create resource (admin)
router.post('/', isAdminAPI, (req, res, next) => {
  try { getUpload().single('file')(req, res, next); }
  catch(err) { res.status(500).json({ success: false, message: 'Upload config error: ' + err.message }); }
}, async (req, res) => {
  try {
    const { title, description, category, price } = req.body;
    if (!req.file) return res.status(400).json({ success: false, message: 'PDF file required' });

    // Cloudinary gives us a secure URL
    const cloudinaryUrl = req.file.path;
    const publicId = req.file.filename;

    const resource = await Resource.create({
      title, description, category,
      price: parseFloat(price) || 50,
      fileName: req.file.originalname,
      filePath: cloudinaryUrl,   // store Cloudinary URL
      cloudinaryId: publicId     // store public_id for deletion
    });
    res.json({ success: true, resource });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH update resource fields (admin)
router.patch('/:id', isAdminAPI, async (req, res) => {
  try {
    const { price, title, category, description } = req.body;
    const update = {};
    if (price !== undefined) update.price = parseFloat(price);
    if (title !== undefined) update.title = title;
    if (category !== undefined) update.category = category;
    if (description !== undefined) update.description = description;
    const resource = await Resource.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!resource) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, resource });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE resource (admin)
router.delete('/:id', isAdminAPI, async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ success: false, message: 'Not found' });
    // Delete from Cloudinary if cloudinaryId exists
    if (resource.cloudinaryId) {
      try {
        const cloudinary = require('cloudinary').v2;
        await cloudinary.uploader.destroy(resource.cloudinaryId, { resource_type: 'raw' });
      } catch {}
    }
    await resource.deleteOne();
    res.json({ success: true, message: 'Resource deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
