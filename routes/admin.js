const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Notice = require('../models/Notice');
const User = require('../models/User');
const Link = require('../models/Link');
const bcrypt = require('bcryptjs');


// JWT middleware for admin authentication
const jwt = require('jsonwebtoken');
function requireAdminJWT(req, res, next) {
  const token = req.cookies.admin_token;
  if (!token) {
    if (req.method === 'GET') return res.redirect('/admin/login');
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET || 'jwtsecret');
    next();
  } catch (err) {
    if (req.method === 'GET') return res.redirect('/admin/login');
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// GET: Admin Login Page
router.get('/login', (req, res) => {
  res.render('admin/login');
});

// POST: Handle Admin Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const admin = await Admin.findOne({ email });
  if (!admin) return res.status(401).json({ error: 'Admin not found' });
  const bcrypt = require('bcryptjs');
  const match = await bcrypt.compare(password, admin.password);
  if (!match) return res.status(401).json({ error: 'Incorrect password' });

  const token = jwt.sign(
    { id: admin._id, email: admin.email, name: admin.name, branch: admin.branch, year: admin.year, role: 'admin' },
    process.env.JWT_SECRET || 'jwtsecret',
    { expiresIn: '1d' }
  );

  res.cookie('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  });
  res.json({ success: true });
});

// GET: Admin Dashboard
router.get('/dashboard', requireAdminJWT, async (req, res) => {
  const notices = await Notice.find().sort({ date: -1 });
  const users = await User.find();
  const Feedback = require('../models/Feedback');
  const feedbacks = await Feedback.find().sort({ createdAt: -1 });
  res.render('admin/dashboard', {
    admin: req.admin,
    notices,
    users,
    feedbacks
  });
});

// POST: Handle New Notice Submission
router.post('/post-notice', requireAdminJWT, async (req, res) => {
  const { title, content } = req.body;
  const { name, branch, year } = req.admin;
  const newNotice = new Notice({
    title,
    message: content,
    date: new Date(),
    postedBy: {
      name,
      branch,
      year
    }
  });
  await newNotice.save();
  res.redirect('/admin/dashboard');
});


// DELETE: Delete a notice
router.post('/delete-notice/:id', requireAdminJWT, async (req, res) => {
  await Notice.findByIdAndDelete(req.params.id);
  res.redirect('/admin/dashboard');
});

// POST: Remove a user
router.post('/remove-user/:id', requireAdminJWT, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.redirect('/admin/dashboard');
});

// GET: Admin Logout
router.get('/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.redirect('/admin/login');
});

// GET: Show Edit Notice Form
router.get('/edit-notice/:id', requireAdminJWT, async (req, res) => {
  const notice = await Notice.findById(req.params.id);
  if (!notice) return res.send('Notice not found');
  res.render('admin/editNotice', { admin: req.admin, notice });
});

// POST: Handle Edit Notice Submission
router.post('/edit-notice/:id', requireAdminJWT, async (req, res) => {
  const { title, content } = req.body;
  await Notice.findByIdAndUpdate(req.params.id, {
    title,
    message: content,
    date: new Date()
  });
  res.redirect('/admin/dashboard');
});

// ===== QUICK LINKS MANAGEMENT =====

// GET: View all links
router.get('/links', requireAdminJWT, async (req, res) => {
  try {
    const links = await Link.find().sort({ category: 1, createdAt: -1 });
    res.render('admin/links', { links, csrfToken: req.csrfToken ? req.csrfToken() : '' });
  } catch (error) {
    console.error('Error fetching links:', error);
    res.status(500).send('Error fetching links');
  }
});

// GET: Add link form
router.get('/add-link', requireAdminJWT, (req, res) => {
  res.render('admin/addLink', { csrfToken: req.csrfToken ? req.csrfToken() : '' });
});

// POST: Add new link
router.post('/add-link', requireAdminJWT, async (req, res) => {
  try {
    const { title, url, category, icon, description } = req.body;

    const link = new Link({
      title,
      url,
      category: category || 'Other',
      icon: icon || 'fa-link',
      description
    });

    await link.save();
    res.redirect('/admin/links');
  } catch (error) {
    console.error('Error adding link:', error);
    res.status(500).send('Error adding link');
  }
});

// GET: Edit link form
router.get('/edit-link/:id', requireAdminJWT, async (req, res) => {
  try {
    const link = await Link.findById(req.params.id);
    if (!link) {
      return res.status(404).send('Link not found');
    }
    res.render('admin/editLink', { link, csrfToken: req.csrfToken ? req.csrfToken() : '' });
  } catch (error) {
    console.error('Error fetching link:', error);
    res.status(500).send('Error fetching link');
  }
});

// POST: Update link
router.post('/edit-link/:id', requireAdminJWT, async (req, res) => {
  try {
    const { title, url, category, icon, description } = req.body;

    await Link.findByIdAndUpdate(req.params.id, {
      title,
      url,
      category: category || 'Other',
      icon: icon || 'fa-link',
      description
    });

    res.redirect('/admin/links');
  } catch (error) {
    console.error('Error updating link:', error);
    res.status(500).send('Error updating link');
  }
});

// POST: Delete link
router.post('/delete-link/:id', requireAdminJWT, async (req, res) => {
  try {
    await Link.findByIdAndDelete(req.params.id);
    res.redirect('/admin/links');
  } catch (error) {
    console.error('Error deleting link:', error);
    res.status(500).send('Error deleting link');
  }
});

module.exports = router;
