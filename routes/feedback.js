
const express = require('express');
const router = express.Router();
const Feedback = require('../models/Feedback');

// In-memory cache to track feedback submissions by IP
const feedbackCache = new Set();

// Submit feedback
router.post('/', async (req, res) => {
  try {
    // Use IP address as identifier (can be replaced with session/cookie if needed)
    const userKey = req.ip;
    if (feedbackCache.has(userKey)) {
      return res.status(429).json({ error: 'You have already submitted feedback.' });
    }
    const { title, details, contact } = req.body;
    if (!title || !details) {
      return res.status(400).json({ error: 'Title and details are required.' });
    }
    const contactStr = contact != null ? String(contact).trim() : '';
    if (contactStr && !/^\d{10}$/.test(contactStr)) {
      return res.status(400).json({ error: 'Contact number must be exactly 10 digits, numbers only.' });
    }
    const feedback = new Feedback({ title, details, contact: contactStr || undefined });
    await feedback.save();
    feedbackCache.add(userKey);
    res.status(201).json({ message: 'Thank you for your feedback!' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit feedback.' });
  }
});

// Get all feedback (admin)
router.get('/', async (req, res) => {
  try {
    const feedbacks = await Feedback.find().sort({ createdAt: -1 });
    res.json(feedbacks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feedback.' });
  }
});

module.exports = router;
