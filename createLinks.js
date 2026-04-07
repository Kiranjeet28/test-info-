const mongoose = require('mongoose');
require('dotenv').config();

const Link = require('./models/Link');

mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('Mongo Error:', err));

async function createLinks() {
  try {
    // Check if links already exist
    const existingLinks = await Link.countDocuments();
    if (existingLinks > 0) {
      console.log('Links already exist in the database. Skipping...');
      mongoose.disconnect();
      return;
    }

    const links = [
      {
        title: 'College Website',
        url: 'https://www.gndec.ac.in/',
        category: 'College',
        icon: 'fa-globe',
        description: 'Official website of Guru Nanak Dev Engineering College'
      },
      {
        title: 'Previous Year Papers',
        url: 'https://drive.google.com/drive/u/0/folders/11ywkOKyeixCPihsCzqZDyzy2msLXxx6w',
        category: 'Academics',
        icon: 'fa-file-pdf',
        description: 'Access previous year exam papers and study materials'
      },
      {
        title: 'TNP Cell (Training & Placement)',
        url: 'https://www.tnpgndec.com/',
        category: 'Placement',
        icon: 'fa-briefcase',
        description: 'Placement portal and company recruitment information'
      }
    ];

    await Link.insertMany(links);
    console.log('✓ Links created successfully!');
    console.log(`✓ Added ${links.length} links to the database`);
    mongoose.disconnect();
  } catch (error) {
    console.error('Error creating links:', error);
    mongoose.disconnect();
    process.exit(1);
  }
}

createLinks();

// Run this script with: node createLinks.js
