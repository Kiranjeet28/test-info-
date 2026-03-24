const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Notice = require('../models/Notice');
const User = require('../models/User');
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
  res.render('admin/dashboard', {
    admin: req.admin,
    notices,
    users
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

module.exports = router;
