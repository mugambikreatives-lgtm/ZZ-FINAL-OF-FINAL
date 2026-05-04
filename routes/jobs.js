const express = require('express');
const router = express.Router();
const axios = require('axios');
const Job = require('../models/Job');
const { isAdminAPI } = require('../middleware/auth');

// ─── CACHE ──────────────────────────────────
// Simple in-memory cache to avoid hitting SerpAPI too often
const jobCache = {
  data: null,
  timestamp: null,
  ttl: 60 * 60 * 1000 // 1 hour
};

function isCacheValid() {
  return jobCache.data && jobCache.timestamp && (Date.now() - jobCache.timestamp < jobCache.ttl);
}

// ─── SERPAPI GOOGLE JOBS ─────────────────────
async function fetchGoogleJobs(query = 'jobs in Kenya', location = 'Kenya') {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error('SERPAPI_KEY not set');

  const params = {
    engine: 'google_jobs',
    q: query,
    location: location,
    hl: 'en',
    gl: 'ke',
    api_key: apiKey
  };

  const res = await axios.get('https://serpapi.com/search', { params });
  return res.data.jobs_results || [];
}

function normalizeGoogleJob(job) {
  // Normalize SerpAPI job format to our app format
  const ext = job.detected_extensions || {};
  return {
    _id: job.job_id || Math.random().toString(36).slice(2),
    title: job.title,
    company: job.company_name,
    location: job.location || 'Kenya',
    type: ext.schedule_type || 'Full-Time',
    category: inferCategory(job.title),
    description: job.description || '',
    salary: ext.salary || null,
    applyLink: job.apply_options?.[0]?.link || job.share_link || null,
    via: job.via || null,
    thumbnail: job.thumbnail || null,
    deadline: null,
    isGoogleJob: true,
    postedAt: ext.posted_at || null,
    requirements: []
  };
}

function inferCategory(title = '') {
  const t = title.toLowerCase();
  if (t.includes('software') || t.includes('developer') || t.includes('engineer') || t.includes('tech') || t.includes('data') || t.includes('it ')) return 'Technology';
  if (t.includes('market') || t.includes('sales') || t.includes('brand') || t.includes('digital')) return 'Marketing';
  if (t.includes('finance') || t.includes('account') || t.includes('audit') || t.includes('banking')) return 'Finance';
  if (t.includes('hr') || t.includes('human resource') || t.includes('recruit') || t.includes('talent')) return 'Human Resources';
  if (t.includes('design') || t.includes('creative') || t.includes('graphic') || t.includes('ui') || t.includes('ux')) return 'Creative';
  if (t.includes('driver') || t.includes('logistics') || t.includes('supply')) return 'Logistics';
  if (t.includes('teacher') || t.includes('education') || t.includes('tutor') || t.includes('trainer')) return 'Education';
  if (t.includes('health') || t.includes('nurse') || t.includes('doctor') || t.includes('medical')) return 'Healthcare';
  return 'Other';
}

// ─── GET JOBS (public) ───────────────────────
router.get('/', async (req, res) => {
  try {
    const { category, type, search, source } = req.query;

    // If SerpAPI key is configured, fetch from Google Jobs
    if (process.env.SERPAPI_KEY && source !== 'manual') {
      // Check cache first
      if (!isCacheValid()) {
        try {
          // Fetch multiple job categories for Kenya
          const queries = [
            'jobs in Nairobi Kenya',
            'remote jobs Kenya',
            'technology jobs Kenya'
          ];

          const results = await Promise.allSettled(
            queries.map(q => fetchGoogleJobs(q, 'Nairobi, Kenya'))
          );

          const allJobs = [];
          const seen = new Set();

          results.forEach(r => {
            if (r.status === 'fulfilled') {
              r.value.forEach(job => {
                const key = `${job.title}-${job.company_name}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  allJobs.push(normalizeGoogleJob(job));
                }
              });
            }
          });

          jobCache.data = allJobs;
          jobCache.timestamp = Date.now();
        } catch (err) {
          console.error('SerpAPI error:', err.message);
          // Fall through to manual jobs
        }
      }

      let jobs = jobCache.data || [];

      // Apply filters
      if (category) jobs = jobs.filter(j => j.category === category);
      if (type) jobs = jobs.filter(j => j.type?.toLowerCase().includes(type.toLowerCase()));
      if (search) {
        const q = search.toLowerCase();
        jobs = jobs.filter(j =>
          j.title?.toLowerCase().includes(q) ||
          j.company?.toLowerCase().includes(q) ||
          j.description?.toLowerCase().includes(q)
        );
      }

      if (jobs.length > 0) {
        return res.json({ success: true, jobs, source: 'google' });
      }
    }

    // Fallback to manually posted jobs
    let query = { isActive: true };
    if (category) query.category = category;
    if (type) query.type = type;
    if (search) query.$or = [
      { title: new RegExp(search, 'i') },
      { company: new RegExp(search, 'i') },
      { description: new RegExp(search, 'i') }
    ];
    const jobs = await Job.find(query).sort('-createdAt');
    res.json({ success: true, jobs, source: 'manual' });

  } catch (err) {
    console.error('Jobs error:', err);
    res.status(500).json({ success: false, message: 'Error fetching jobs' });
  }
});

// ─── GET single job ──────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST create job (admin manual) ──────────
router.post('/', isAdminAPI, async (req, res) => {
  try {
    const { title, company, location, type, category, description, requirements, salary, applyLink, applyEmail, deadline } = req.body;
    const job = await Job.create({
      title, company, location, type, category, description,
      requirements: Array.isArray(requirements) ? requirements : requirements?.split('\n').filter(Boolean),
      salary, applyLink, applyEmail,
      deadline: deadline ? new Date(deadline) : null
    });
    // Clear cache so new job shows alongside Google jobs
    jobCache.data = null;
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE job (admin) ──────────────────────
router.delete('/:id', isAdminAPI, async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    jobCache.data = null;
    res.json({ success: true, message: 'Job deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Refresh cache (admin) ───────────────────
router.post('/refresh-cache', isAdminAPI, async (req, res) => {
  jobCache.data = null;
  jobCache.timestamp = null;
  res.json({ success: true, message: 'Job cache cleared. Next visit will fetch fresh jobs.' });
});

module.exports = router;
