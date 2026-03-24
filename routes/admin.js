const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Notice = require('../models/Notice');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// GET: Admin Login Page
router.get('/login', (req, res) => {
  res.render('admin/login');
});

// POST: Handle Admin Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const admin = await Admin.findOne({ email });
  if (!admin) return res.status(401).json({ error: 'Admin not found' });
  const match = await bcrypt.compare(password, admin.password);
  if (!match) return res.status(401).json({ error: 'Incorrect password' });

  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { id: admin._id, email: admin.email, role: 'admin' },
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
router.get('/dashboard', async (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.cookies.admin_token;
  let adminPayload = null;

  if (token) {
    try {
      adminPayload = jwt.verify(token, process.env.JWT_SECRET || 'jwtsecret');
    } catch (err) {
      return res.redirect('/admin/login');
    }
  } else {
    return res.redirect('/admin/login');
  }

  const notices = await Notice.find().sort({ date: -1 });
  const users = await User.find();
  res.render('admin/dashboard', {
    admin: adminPayload,
    notices,
    users
  });
});

// POST: Handle New Notice Submission
router.post('/post-notice', async (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.cookies.admin_token;
  let adminPayload = null;

  if (token) {
    try {
      adminPayload = jwt.verify(token, process.env.JWT_SECRET || 'jwtsecret');
    } catch (err) {
      return res.redirect('/admin/login');
    }
  } else {
    return res.redirect('/admin/login');
  }

  const { title, content } = req.body;
  const { name, branch, year } = adminPayload;
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
router.post('/delete-notice/:id', async (req, res) => {
  if (!req.session.admin) return res.redirect('/admin/login');
  await Notice.findByIdAndDelete(req.params.id);
  res.redirect('/admin/dashboard');
});

// POST: Remove a user
router.post('/remove-user/:id', async (req, res) => {
  if (!req.session.admin) return res.redirect('/admin/login');
  await User.findByIdAndDelete(req.params.id);
  res.redirect('/admin/dashboard');
});

// GET: Admin Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// GET: Show Edit Notice Form
router.get('/edit-notice/:id', async (req, res) => {
  if (!req.session.admin) return res.redirect('/admin/login');
  const notice = await Notice.findById(req.params.id);
  if (!notice) return res.send('Notice not found');
  res.render('admin/editNotice', { admin: req.session.admin, notice });
});

// POST: Handle Edit Notice Submission
router.post('/edit-notice/:id', async (req, res) => {
  if (!req.session.admin) return res.redirect('/admin/login');
  const { title, content } = req.body;
  await Notice.findByIdAndUpdate(req.params.id, {
    title,
    message: content,
    date: new Date()
  });
  res.redirect('/admin/dashboard');
});

module.exports = router;
