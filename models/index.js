const mongoose = require('mongoose');

// PDF Resource Model
const resourceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, default: 'General' },
  price: { type: Number, required: true, default: 100 },
  filename: { type: String, required: true },
  filepath: { type: String, required: true },
  thumbnail: { type: String },
  downloads: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Payment Log Model
const paymentSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  amount: { type: Number, required: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource' },
  type: { type: String, enum: ['pdf', 'cv'], required: true },
  checkoutRequestId: { type: String },
  merchantRequestId: { type: String },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  mpesaReceiptNumber: { type: String },
  cvData: { type: Object },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date }
});

// Job Posting Model
const jobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  company: { type: String, required: true },
  location: { type: String, required: true },
  type: { type: String, enum: ['Full-time', 'Part-time', 'Contract', 'Remote', 'Internship'], default: 'Full-time' },
  category: { type: String, default: 'General' },
  description: { type: String, required: true },
  requirements: [String],
  salary: { type: String },
  deadline: { type: Date },
  contactEmail: { type: String },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const Resource = mongoose.model('Resource', resourceSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const Job = mongoose.model('Job', jobSchema);

module.exports = { Resource, Payment, Job };
