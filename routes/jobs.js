const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const { isAdminAPI } = require('../middleware/auth');

// GET all jobs (public)
router.get('/', async (req, res) => {
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
    const jobs = await Job.find(query).sort('-createdAt');
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching jobs' });
  }
});

// GET single job
router.get('/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create job (admin)
router.post('/', isAdminAPI, async (req, res) => {
  try {
    const { title, company, location, type, category, description, requirements, salary, applyLink, applyEmail, deadline } = req.body;
    const job = await Job.create({
      title, company, location, type, category, description,
      requirements: Array.isArray(requirements) ? requirements : requirements?.split('\n').filter(Boolean),
      salary, applyLink, applyEmail,
      deadline: deadline ? new Date(deadline) : null
    });
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE job (admin)
router.delete('/:id', isAdminAPI, async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Job deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
