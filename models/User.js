


const mongoose = require('mongoose');


const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true },
  password: { type: String }, // For authentication
  branch: String,
  year: String,
  urn: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^\d{7}$/.test(v);
      },
      message: 'URN must be exactly 7 digits.'
    }
  },
  crn: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^\d{7}$/.test(v);
      },
      message: 'CRN must be exactly 7 digits.'
    }
  },
  group: { type: String },
  department: { type: String },
  subscribedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', userSchema);
