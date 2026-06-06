const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  checkoutRequestId: { type: String, unique: true },
  merchantRequestId: { type: String },
  phone: { type: String, required: true },
  amount: { type: Number, required: true },
  type: { type: String, enum: ['resource', 'cv'], required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', default: null },
  cvData: { type: Object, default: null },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  mpesaReceiptNumber: { type: String },
  downloadToken: { type: String },
  downloadExpiry: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Payment', paymentSchema);
