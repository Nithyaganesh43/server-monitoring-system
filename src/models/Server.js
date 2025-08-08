const mongoose = require('mongoose');

const serverSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  url: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'checking'],
    default: 'checking'
  },
  responseTime: {
    type: Number,
    default: 0
  },
  lastCheck: {
    type: Date,
    default: Date.now
  },
  consecutiveFailures: {
    type: Number,
    default: 0
  },
  alertEnabled: {
    type: Boolean,
    default: true
  },
  alertSent: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

serverSchema.index({ userEmail: 1, url: 1 }, { unique: true });
serverSchema.index({ status: 1, alertEnabled: 1 });

module.exports = mongoose.model('Server', serverSchema);