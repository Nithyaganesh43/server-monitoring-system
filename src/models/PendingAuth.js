const mongoose = require('mongoose');
const validator = require('validator');

const pendingAuthSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    validate: [validator.isEmail, 'Invalid email format']
  },
  deviceId: {
    type: String,
    required: true,
    trim: true
  },
  token: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    expires: 0
  }
}, {
  timestamps: true
});
 
module.exports = mongoose.model('PendingAuth', pendingAuthSchema);