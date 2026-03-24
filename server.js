// Load environment variables from .env file
require('dotenv').config();


const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const moment = require('moment-timezone');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const csurf = require('csurf');
const app = express();

// Middleware

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'Public'))); // <- ensure this line exists
app.set('view engine', 'ejs');

// CSRF protection
app.use(csurf({ cookie: true }));

// Pass csrfToken to all views
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  next();
});

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'changeme-please',
  resave: false,
  saveUninitialized: false
}));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log(' MongoDB Connected'))
  .catch(err => console.error('Mongo Error:', err));


// JWT middleware for user authentication (optional, for protected routes)
app.use((req, res, next) => {
  const token = req.cookies.token;
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET || 'jwtsecret');
    } catch (err) {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
});

// Routes
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');

app.use('/admin', adminRoutes); // Admin dashboard
app.use('/', userRoutes);       // Home + subscription

// Timezone configuration
app.locals.formatIST = function(date) {
  return moment(date).tz('Asia/Kolkata').format('DD/MM/YYYY, h:mm:ss a');
};

// Start Server
const PORT = process.env.PORT || 5000;
// simple request logger for debugging deployed requests
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.url, req.body && Object.keys(req.body).length ? req.body : '');
  next();
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500);
  if (req.accepts('json')) {
    res.json({ error: err.message || 'Internal Server Error' });
  } else {
    res.type('txt').send(err.message || 'Internal Server Error');
  }
});

app.listen(PORT, () => {
  console.log(` Server running on http://localhost:${PORT}`);
});
