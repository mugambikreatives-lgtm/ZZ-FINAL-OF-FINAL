require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'zenithzoom-secret-2024',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost/zenithzoom' }),
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
}));

// TEMPORARY password reset route - remove after use
app.get('/reset-admin-password', async (req, res) => {
  try {
    const Admin = require('./models/Admin');
    await Admin.deleteMany({});
    await Admin.create({
      email: 'admin@zenithzoom.com',
      password: 'ZenithAdmin2025'
    });
    res.send('✅ Admin reset! Email: admin@zenithzoom.com | Password: ZenithAdmin2025 | <a href="/admin/login">Login now</a>');
  } catch(err) {
    res.send('Error: ' + err.message);
  }
});

// Routes
app.use('/api/mpesa', require('./routes/mpesa'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/admin', require('./routes/admin'));

// Serve main app pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views/index.html')));
app.get('/resources', (req, res) => res.sendFile(path.join(__dirname, 'views/index.html')));
app.get('/cv-builder', (req, res) => res.sendFile(path.join(__dirname, 'views/index.html')));
app.get('/jobs', (req, res) => res.sendFile(path.join(__dirname, 'views/index.html')));

// Connect to MongoDB and start server
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/zenithzoom')
  .then(async () => {
    console.log('✅ MongoDB connected');
    await seedAdmin();
    await seedSampleData();
    // Only call listen if not already handled by host
    if (!module.parent) {
      app.listen(PORT, () => console.log(`🚀 Zenith Zoom running on port ${PORT}`));
    }
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    if (!module.parent) {
      app.listen(PORT, () => console.log(`🚀 Zenith Zoom running on port ${PORT} (no DB)`));
    }
  });

async function seedAdmin() {
  try {
    const Admin = require('./models/Admin');
    const exists = await Admin.findOne({ email: process.env.ADMIN_EMAIL || 'admin@zenithzoom.com' });
    if (!exists) {
      await Admin.create({
        email: process.env.ADMIN_EMAIL || 'admin@zenithzoom.com',
        password: process.env.ADMIN_PASSWORD || 'Admin123!'
      });
      console.log('✅ Admin seeded');
    }
  } catch (err) { console.log('Admin seed skipped:', err.message); }
}

async function seedSampleData() {
  try {
    const Job = require('./models/Job');
    const count = await Job.countDocuments();
    if (count === 0) {
      await Job.insertMany([
        { title: 'Frontend Developer', company: 'TechBridge Kenya', location: 'Nairobi', type: 'Full-Time', category: 'Technology', description: 'Build modern web applications using React and Node.js.', requirements: ['3+ years React experience', 'Strong CSS skills', 'Git proficiency'], salary: 'KES 80,000 – 120,000/month', applyEmail: 'careers@techbridge.co.ke', deadline: new Date(Date.now() + 30*86400000) },
        { title: 'Digital Marketing Specialist', company: 'Brand Afrika', location: 'Remote', type: 'Remote', category: 'Marketing', description: 'Drive digital campaigns across social media and paid channels.', requirements: ['Google Ads certified', 'SEO knowledge', '2+ years experience'], salary: 'KES 60,000 – 90,000/month', applyEmail: 'hr@brandafrika.com', deadline: new Date(Date.now() + 20*86400000) },
        { title: 'Data Science Intern', company: 'Strathmore University', location: 'Nairobi', type: 'Internship', category: 'Data & Analytics', description: 'Support research projects using Python and machine learning.', requirements: ['Python proficiency', 'Statistics background', 'Currently enrolled in relevant degree'], salary: 'KES 15,000/month stipend', applyEmail: 'intern@strathmore.edu', deadline: new Date(Date.now() + 15*86400000) },
        { title: 'HR Manager', company: 'Equity Bank Kenya', location: 'Nairobi', type: 'Full-Time', category: 'Human Resources', description: 'Lead HR operations for a 500+ employee division.', requirements: ['CHRP certified', '5+ years HR management', 'Labour law knowledge'], salary: 'KES 150,000 – 200,000/month', applyEmail: 'careers@equitybank.co.ke', deadline: new Date(Date.now() + 25*86400000) },
        { title: 'Graphic Designer', company: 'Creatives Hub', location: 'Nairobi', type: 'Part-Time', category: 'Creative', description: 'Create visual content for brands across East Africa.', requirements: ['Adobe Creative Suite', 'Portfolio required', 'Brand identity experience'], salary: 'KES 40,000/month', applyEmail: 'design@creativeshub.co.ke', deadline: new Date(Date.now() + 10*86400000) }
      ]);
      console.log('✅ Sample jobs seeded');
    }
  } catch (err) { console.log('Job seed skipped:', err.message); }
}

module.exports = app;
