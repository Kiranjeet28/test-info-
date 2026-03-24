const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    maxlength: 100
  },
  details: {
    type: String,
    required: true,
    maxlength: 500
  },
  contact: {
    type: String,
    maxlength: 10
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Feedback', feedbackSchema);
