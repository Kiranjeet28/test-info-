const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const Notice = require('../models/Notice');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');
const { fetchDepartments, fetchGroups } = require('../utils/departmentUtils');
const TIMETABLE_CACHE_TTL_MS = 5 * 60 * 1000;
const timetableCache = new Map();

// JWT authentication middleware for user
function requireUserJWT(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    if (req.method === 'GET') return res.redirect('/login');
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'jwtsecret');
    next();
  } catch (err) {
    if (req.method === 'GET') return res.redirect('/login');
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

const DEPARTMENT_CONFIG = [
  { key: 'appliedscience', label: 'Applied Science', file: 'timetable_appliedscience.json' },
  { key: 'bca', label: 'BCA', file: 'timetable_bca.json' },
  { key: 'civil', label: 'Civil Engineering', file: 'timetable_civil.json' },
  { key: 'cse', label: 'Computer Science & Engineering', file: 'timetable_cse.json' },
  { key: 'ece', label: 'Electronics & Communication Engineering', file: 'timetable_ece.json' },
  { key: 'electrical', label: 'Electrical Engineering', file: 'timetable_electrical.json' },
  { key: 'it', label: 'Information Technology', file: 'timetable_it.json' },
  { key: 'mechanical', label: 'Mechanical Engineering', file: 'timetable_mechanical.json' }
];

function readTimetableFile(fileName) {
  const absolutePath = path.join(__dirname, '..', 'web', fileName);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw);
}

function pickFirstAvailableGroup(timetableMap) {
  if (!timetableMap || typeof timetableMap !== 'object') return { groupName: null, groupData: null };
  const groupNames = Object.keys(timetableMap);
  for (const groupName of groupNames) {
    const classes = timetableMap[groupName] && Array.isArray(timetableMap[groupName].classes)
      ? timetableMap[groupName].classes
      : [];
    if (classes.length > 0) {
      return { groupName, groupData: timetableMap[groupName] };
    }
  }
  return { groupName: groupNames[0] || null, groupData: timetableMap[groupNames[0]] || null };
}

function normalizeClassesByDay(groupData) {
  const classes = groupData && Array.isArray(groupData.classes) ? groupData.classes : [];
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayBuckets = {};

  for (const day of dayOrder) dayBuckets[day] = [];

  for (const item of classes) {
    const day = item.dayOfClass || 'Unknown';
    if (!dayBuckets[day]) dayBuckets[day] = [];

    const data = item.data || {};
    const entries = Array.isArray(data.entries) && data.entries.length > 0
      ? data.entries
      : [{
        subject: data.subject || null,
        teacher: data.teacher || null,
        classRoom: data.classRoom || null
      }];

    dayBuckets[day].push({
      time: item.timeOfClass || '',
      isFree: Boolean(data.freeClass),
      isLab: Boolean(data.Lab),
      isTutorial: Boolean(data.Tut),
      isElective: Boolean(data.elective),
      otherDepartment: Boolean(data.OtherDepartment),
      entries
    });
  }

  Object.values(dayBuckets).forEach((periods) => {
    periods.sort((a, b) => {
      const [ah, am] = (a.time || '').split(':').map(Number);
      const [bh, bm] = (b.time || '').split(':').map(Number);
      const aMins = Number.isFinite(ah) && Number.isFinite(am) ? ah * 60 + am : Number.MAX_SAFE_INTEGER;
      const bMins = Number.isFinite(bh) && Number.isFinite(bm) ? bh * 60 + bm : Number.MAX_SAFE_INTEGER;
      return aMins - bMins;
    });
  });

  return dayBuckets;
}

function loadDepartmentTimetables() {
  return DEPARTMENT_CONFIG.map((department) => {
    try {
      const payload = readTimetableFile(department.file);
      const { groupName, groupData } = pickFirstAvailableGroup(payload.timetable);
      return {
        key: department.key,
        label: department.label,
        groupName,
        days: normalizeClassesByDay(groupData),
        sourceUrl: payload.url || null
      };
    } catch (error) {
      return {
        key: department.key,
        label: department.label,
        groupName: null,
        days: {},
        sourceUrl: null
      };
    }
  });
}

function getDepartmentOptions() {
  return fetchDepartments();
}

function getGroupsByDepartment(departmentKey) {
  return fetchGroups(departmentKey);
}

function getCachedTimetable(cacheKey) {
  const cached = timetableCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > TIMETABLE_CACHE_TTL_MS) {
    timetableCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedTimetable(cacheKey, value) {
  timetableCache.set(cacheKey, {
    createdAt: Date.now(),
    value
  });
}

function getDepartmentByKey(departmentKey) {
  return DEPARTMENT_CONFIG.find((item) => item.key === departmentKey) || null;
}

function buildDepartmentTimetableForGroup(departmentKey, requestedGroup) {
  const department = getDepartmentByKey(departmentKey);
  if (!department) return null;
  const payload = readTimetableFile(department.file);
  const timetableMap = payload.timetable || {};
  const groupNames = Object.keys(timetableMap);
  const matchedGroup = groupNames.find((name) => name.toLowerCase() === String(requestedGroup || '').toLowerCase()) || null;
  const targetGroup = matchedGroup || groupNames[0] || null;
  if (!targetGroup) return null;

  return {
    department: {
      key: department.key,
      label: department.label
    },
    groupName: targetGroup,
    days: normalizeClassesByDay(timetableMap[targetGroup]),
    sourceUrl: payload.url || null,
    cachedAt: new Date().toISOString()
  };
}

function parseTimeToMinutes(timeValue) {
  const [hoursStr, minsStr] = String(timeValue || '').split(':');
  const hours = Number(hoursStr);
  const minutes = Number(minsStr);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60) + minutes;
}

function getIstNowContext() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(new Date());
  const weekdayPart = parts.find((part) => part.type === 'weekday');
  const hourPart = parts.find((part) => part.type === 'hour');
  const minutePart = parts.find((part) => part.type === 'minute');

  const dayName = weekdayPart ? weekdayPart.value : 'Monday';
  const hour = Number(hourPart ? hourPart.value : 0);
  const minute = Number(minutePart ? minutePart.value : 0);
  return {
    dayName,
    nowMinutes: (hour * 60) + minute
  };
}

function getStudentLiveClassSummary(timetablePayload) {
  if (!timetablePayload || !timetablePayload.days) return null;
  const { dayName, nowMinutes } = getIstNowContext();
  const dayPeriods = Array.isArray(timetablePayload.days[dayName]) ? timetablePayload.days[dayName] : [];
  if (!dayPeriods.length) {
    return {
      dayName,
      presentClass: null,
      nextClass: null
    };
  }

  const periods = dayPeriods
    .map((period) => ({ ...period, startMins: parseTimeToMinutes(period.time) }))
    .filter((period) => Number.isFinite(period.startMins))
    .sort((a, b) => a.startMins - b.startMins);

  if (!periods.length) {
    return {
      dayName,
      presentClass: null,
      nextClass: null
    };
  }

  let presentClass = null;
  let nextClass = null;

  for (let index = 0; index < periods.length; index += 1) {
    const current = periods[index];
    const next = periods[index + 1] || null;
    const currentEnd = next ? next.startMins : current.startMins + 60;

    if (nowMinutes >= current.startMins && nowMinutes < currentEnd) {
      presentClass = current;
      nextClass = next;
      break;
    }

    if (nowMinutes < current.startMins) {
      nextClass = current;
      break;
    }
  }

  return {
    dayName,
    presentClass,
    nextClass
  };
}
// Registration page
router.get('/register', (req, res) => {
  const departmentOptions = getDepartmentOptions();
  res.render('user/register', { departmentOptions });
});

// Login page
router.get('/login', (req, res) => {
  res.render('user/login');
});

// User logout route
router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

// Student registration POST
router.post('/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required.'),
    body('email').trim().isEmail().withMessage('Valid email is required.').custom((value) => {
      if (!String(value).toLowerCase().endsWith('@gmail.com')) {
        throw new Error('Email must be a Gmail address (@gmail.com).');
      }
      return true;
    }),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
    body('urn').matches(/^\d{7}$/).withMessage('URN must be exactly 7 digits.'),
    body('crn').matches(/^\d{7}$/).withMessage('CRN must be exactly 7 digits.'),
    body('group').trim().notEmpty().withMessage('Group is required.'),
    body('department').trim().notEmpty().withMessage('Department is required.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { name, password, urn, crn, group, department } = req.body;
    const email = String(req.body.email).trim().toLowerCase();
    const groups = getGroupsByDepartment(department);
    if (!groups.includes(group)) {
      return res.status(400).json({ error: 'Selected group does not belong to selected department.' });
    }
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already registered.' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword, urn, crn, group, department });
    await user.save();
    if (req.accepts('json')) {
      return res.json({ success: true });
    }
    return res.redirect('/login');
  }
);

// Student login POST
router.post('/login',
  [
    body('email').trim().isEmail().withMessage('Valid email is required.').custom((value) => {
      if (!String(value).toLowerCase().endsWith('@gmail.com')) {
        throw new Error('Email must be a Gmail address (@gmail.com).');
      }
      return true;
    }),
    body('password').notEmpty().withMessage('Password is required.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const email = String(req.body.email).trim().toLowerCase();
    const { password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    // Create JWT token
    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET || 'jwtsecret', { expiresIn: '1d' });
    // Set token as HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    });
    res.json({ success: true });
  }
);

// create transporter once (will use env vars on Render)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Home page showing latest notices + subscription form
router.get('/', async (req, res) => {
  const notices = await Notice.find().sort({ date: -1 });
  const currentUser = req.user ? await User.findById(req.user.id).lean() : null;
  let studentClassSummary = null;

  if (currentUser && currentUser.department && currentUser.group) {
    const timetablePayload = buildDepartmentTimetableForGroup(currentUser.department, currentUser.group);
    if (timetablePayload) {
      studentClassSummary = {
        departmentLabel: timetablePayload.department.label,
        groupName: timetablePayload.groupName,
        ...getStudentLiveClassSummary(timetablePayload)
      };
    }
  }

  res.render('user/home', { notices, currentUser, studentClassSummary });
});

router.get('/timetable', async (req, res) => {
  const currentUser = req.user ? await User.findById(req.user.id).lean() : null;
  const departmentOptions = getDepartmentOptions();
  res.render('user/timetable', { currentUser, departmentOptions });
});

router.get('/profile', requireUserJWT, async (req, res) => {
  const currentUser = await User.findById(req.user.id).lean();
  if (!currentUser) return res.status(404).send('User not found');
  res.render('user/profile', { currentUser });
});

router.get('/api/departments', (req, res) => {
  res.json({ departments: getDepartmentOptions() });
});

router.get('/api/groups/:department', (req, res) => {
  const departmentKey = req.params.department;
  const groups = getGroupsByDepartment(departmentKey);
  res.json({ department: departmentKey, groups });
});

router.get('/api/timetable/:department/:group', (req, res) => {
  const department = req.params.department;
  const group = req.params.group;
  const cacheKey = `${department}:${group}`;
  const cached = getCachedTimetable(cacheKey);
  if (cached) {
    return res.json({ ...cached, cache: { hit: true, ttlMs: TIMETABLE_CACHE_TTL_MS } });
  }

  const payload = buildDepartmentTimetableForGroup(department, group);
  if (!payload) {
    return res.status(404).json({ error: 'Timetable not found for the requested department/group.' });
  }

  setCachedTimetable(cacheKey, payload);
  return res.json({ ...payload, cache: { hit: false, ttlMs: TIMETABLE_CACHE_TTL_MS } });
});

// Contact form POST
router.post('/contact', async (req, res) => {
  console.log('[/contact] body:', req.body);
  try {
    const { name, email, message } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email and message are required.' });
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: 'infocascade.gndec@gmail.com',
      subject: `infocascade query from ${name}`,
      replyTo: email,
      text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('[/contact] mail sent:', info && info.response ? info.response : info);
    return res.json({ ok: true, message: 'Your message has been sent to the admin.' });
  } catch (err) {
    console.error('[/contact] send error:', err);
    return res.status(500).json({ error: 'Unable to send message at this time.' });
  }
});


module.exports = router;




