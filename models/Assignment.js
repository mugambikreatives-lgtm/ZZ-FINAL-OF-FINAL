const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  courseId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  fileName:   { type: String, required: true },
  fileOriginalName: { type: String, required: true },
  filePath:   { type: String, required: true },
  fileType:   { type: String }, // 'pdf' or 'docx'
  fileSize:   { type: Number },
  status:     { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  tutorNote:  { type: String, default: '' },
  submittedAt:{ type: Date, default: Date.now },
  reviewedAt: { type: Date },
  reviewedBy: { type: String }
});

module.exports = mongoose.model('Assignment', assignmentSchema);
