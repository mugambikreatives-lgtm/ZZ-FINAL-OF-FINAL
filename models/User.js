const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const purchasedCourseSchema = new mongoose.Schema({
  resourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  purchasedAt: { type: Date, default: Date.now },
  amountPaid: { type: Number },
  progress: { type: Number, default: 0 },
  totalPages: { type: Number, default: 0 },
  lastViewed: { type: Date }
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String },
  googleId: { type: String },
  avatar: { type: String },
  phone: { type: String },
  purchasedCourses: [purchasedCourseSchema],
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date }
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();
  const bcrypt = require('bcryptjs');
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidate) {
  const bcrypt = require('bcryptjs');
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.ownsCourse = function(resourceId) {
  return this.purchasedCourses.some(c => c.resourceId.toString() === resourceId.toString());
};

module.exports = mongoose.model('User', userSchema);
