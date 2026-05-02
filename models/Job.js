const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  company: { type: String, required: true },
  location: { type: String, required: true },
  type: { type: String, enum: ['Full-Time', 'Part-Time', 'Contract', 'Internship', 'Remote'], required: true },
  category: { type: String, required: true },
  description: { type: String, required: true },
  requirements: [String],
  salary: { type: String },
  applyLink: { type: String },
  applyEmail: { type: String },
  deadline: { type: Date },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Job', jobSchema);
