const mongoose = require('mongoose');

const subscriberSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  urn: {
    type: String,
    required: true,
    validate: {
      validator: (v) => /^\d+$/.test(v),
      message: (props) => `${props.value} is not a valid URN. Only numbers are allowed.`
    }
  },
  crn: {
    type: String,
    required: true,
    validate: {
      validator: (v) => /^\d+$/.test(v),
      message: (props) => `${props.value} is not a valid CRN. Only numbers are allowed.`
    }
  },
  department: { type: String, required: true, trim: true },
  subscribedAt: { type: Date, default: Date.now }
});

subscriberSchema.index({ urn: 1, crn: 1, department: 1 }, { unique: true });

module.exports = mongoose.model('Subscriber', subscriberSchema);
