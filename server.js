require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const cookieParser = require('cookie-parser');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(morgan('combined'));
app.use(cookieParser());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'zenithzoom-secret-2024',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost/zenithzoom' }),
  cookie: { 
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

// Passport
const passport = require('passport');
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/api/auth', require('./routes/auth').router);
app.use('/api/mpesa', require('./routes/mpesa'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/admin', require('./routes/admin'));
app.use('/api/user', require('./routes/user'));
app.use('/api/assignments', require('./routes/assignments'));


// User pages
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views/login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views/user-dashboard.html')));

// Fix courses grid - serves patched index.html
app.get('/', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  let html = fs.readFileSync(path.join(__dirname, 'views/index.html'), 'utf8');
  // Patch: ensure renderCourses works with both grid IDs
  html = html.replace(
    "const grid = document.getElementById('course-grid');",
    "const grid = document.getElementById('course-grid') || document.getElementById('resource-grid'); if(!grid) return;"
  );
  res.send(html);
});

app.get('/courses', (req, res) => res.redirect('/'));
app.get('/cv-builder', (req, res) => res.redirect('/'));
app.get('/jobs', (req, res) => res.redirect('/'));

// Health check — shows DB status and env vars (safe subset)
app.get('/api/health', (req, res) => {
  const states = ['disconnected','connected','connecting','disconnecting'];
  res.json({
    status: 'ok',
    db: states[mongoose.connection.readyState] || 'unknown',
    env: {
      MONGODB_URI: process.env.MONGODB_URI ? '✅ set' : '❌ MISSING',
      SESSION_SECRET: process.env.SESSION_SECRET ? '✅ set' : '❌ missing (using default)',
      KCB_CONSUMER_KEY: process.env.KCB_CONSUMER_KEY ? '✅ set' : '❌ missing',
      CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ? '✅ set' : '❌ missing',
    },
    time: new Date().toISOString()
  });
});

// Connect to MongoDB and start server
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/zenithzoom', {
  serverSelectionTimeoutMS: 8000,   // fail fast if Atlas unreachable
  connectTimeoutMS: 10000,
  socketTimeoutMS: 30000,
})
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

  // Seed sample courses/resources if none exist
  try {
    const Resource = require('./models/Resource');
    const rCount = await Resource.countDocuments();
    if (rCount === 0) {
      await Resource.insertMany([
        {
          title: 'Digital Marketing Mastery',
          description: 'Complete guide to social media marketing, SEO, Google Ads, and growing brands online in the African market.',
          category: 'Marketing',
          price: 500,
          fileName: 'digital-marketing-mastery.pdf',
          filePath: 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf', // placeholder — replace via admin
          isActive: true
        },
        {
          title: 'Business Finance & Accounting',
          description: 'Learn bookkeeping, financial statements, budgeting, and M-Pesa business accounting for Kenyan entrepreneurs.',
          category: 'Finance',
          price: 700,
          fileName: 'business-finance.pdf',
          filePath: 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf',
          isActive: true
        },
        {
          title: 'Web Development Fundamentals',
          description: 'HTML, CSS, JavaScript and Node.js from scratch. Build real websites and start freelancing within 30 days.',
          category: 'Technology',
          price: 1000,
          fileName: 'web-dev-fundamentals.pdf',
          filePath: 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf',
          isActive: true
        },
        {
          title: 'Career Development & Job Hunting',
          description: 'CV writing, interview skills, LinkedIn optimization, and networking strategies for Kenya\'s job market.',
          category: 'Career Development',
          price: 400,
          fileName: 'career-development.pdf',
          filePath: 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf',
          isActive: true
        },
        {
          title: 'Leadership & Team Management',
          description: 'Develop leadership skills, manage remote teams, conflict resolution, and build high-performance organizations.',
          category: 'Leadership',
          price: 800,
          fileName: 'leadership-management.pdf',
          filePath: 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf',
          isActive: true
        },
        {
          title: 'Entrepreneurship in Kenya',
          description: 'From idea to registered business: business plan writing, funding, KRA compliance, and scaling your startup.',
          category: 'Business',
          price: 600,
          fileName: 'entrepreneurship-kenya.pdf',
          filePath: 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf',
          isActive: true
        }
      ]);
      console.log('✅ Sample courses seeded — replace filePaths via admin dashboard');
    }
  } catch (err) { console.log('Resource seed skipped:', err.message); }
}

module.exports = app;
