


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
        return /^\d+$/.test(v);
      },
      message: props => `${props.value} is not a valid URN. Only numbers are allowed.`
    }
  },
  crn: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^\d+$/.test(v);
      },
      message: props => `${props.value} is not a valid CRN. Only numbers are allowed.`
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
