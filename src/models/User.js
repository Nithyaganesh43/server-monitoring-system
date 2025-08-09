const mongoose = require('mongoose');
const validator = require('validator');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    validate: [validator.isEmail, 'Invalid email format']
  },
  deviceId: {
    type: String,
    required: true,
    trim: true
  },
  verified: {
    type: Boolean,
    default: false
  },
  maxServers: {
    type: Number,
    default: 10,
    min: 1,
    max: 100
  }
}, {
  timestamps: true
}); 

module.exports = mongoose.model('User', userSchema);