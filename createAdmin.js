const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const Admin = require('./models/Admin');

mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log('MongoDB Connected '))
  .catch(err => console.error('Mongo Error ', err));

async function createAdmin() {

  const hashedPassword = await bcrypt.hash('Jayant@110125', 10); // change this password
  const admin = new Admin({
    name: "Jayant Kumawat",
    email: "jayantkumawat802@gmail.com",
    password: hashedPassword,
    year: "3rd",
    branch: "CSE"
  });

  await admin.save();
  console.log(' Admin created successfully!');
  mongoose.disconnect();
}

createAdmin();


//node createAdmin.js
// This script creates an admin user in the MongoDB database.