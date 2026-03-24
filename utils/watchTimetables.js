// watchTimetables.js
// Monitors timetable websites for changes and triggers scraper when changes are detected

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TIMETABLE_URLS = require('./timetableUrls');

// Path to store content hashes
const HASH_CACHE_FILE = path.join(__dirname, '.timetable-hashes.json');

// Check interval in milliseconds (default: 5 minutes)
const CHECK_INTERVAL = process.env.CHECK_INTERVAL 
  ? parseInt(process.env.CHECK_INTERVAL, 10) 
  : 5 * 60 * 1000;

// Load cached hashes
function loadHashCache() {
  try {
    if (fs.existsSync(HASH_CACHE_FILE)) {
      const data = fs.readFileSync(HASH_CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading hash cache:', err.message);
  }
  return {};
}

// Save hashes to cache
function saveHashCache(cache) {
  try {
    fs.writeFileSync(HASH_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('Error saving hash cache:', err.message);
  }
}

// Generate hash from content
function generateHash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

// Fetch content from URL
async function fetchContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return response.data;
  } catch (err) {
    console.error(`Error fetching ${url}:`, err.message);
    return null;
  }
}

// Run the scraper for a specific department
function runDepartmentScraper(department) {
  const scriptPath = path.join(__dirname, department, 'scrapeTimetable.js');
  
  if (!fs.existsSync(scriptPath)) {
    console.error(`Scraper not found for ${department}: ${scriptPath}`);
    return false;
  }
  
  try {
    console.log(`\n🔄 Running scraper for ${department}...`);
    execSync(`node ${scriptPath}`, { stdio: 'inherit' });
    console.log(`✅ Scraper completed for ${department}`);
    return true;
  } catch (err) {
    console.error(`❌ Scraper failed for ${department}:`, err.message);
    return false;
  }
}

// Run all scrapers
function runAllScrapers() {
  const scriptPath = path.join(__dirname, 'runAllTimetables.js');
  
  try {
    console.log('\n🔄 Running all scrapers...');
    execSync(`node ${scriptPath}`, { stdio: 'inherit' });
    console.log('✅ All scrapers completed');
    return true;
  } catch (err) {
    console.error('❌ Error running all scrapers:', err.message);
    return false;
  }
}

// Check for changes in all timetable URLs
async function checkForChanges() {
  console.log(`\n[${new Date().toISOString()}] Checking for timetable changes...`);
  
  const hashCache = loadHashCache();
  const changedDepartments = [];
  const newHashes = { ...hashCache };
  
  for (const [department, url] of Object.entries(TIMETABLE_URLS)) {
    console.log(`  Checking ${department}...`);
    
    const content = await fetchContent(url);
    
    if (!content) {
      console.log(`  ⚠️  Could not fetch ${department}, skipping...`);
      continue;
    }
    
    const currentHash = generateHash(content);
    const previousHash = hashCache[department];
    
    if (!previousHash) {
      console.log(`  📝 First check for ${department}, storing hash...`);
      newHashes[department] = currentHash;
    } else if (currentHash !== previousHash) {
      console.log(`  🔔 CHANGE DETECTED in ${department}!`);
      changedDepartments.push(department);
      newHashes[department] = currentHash;
    } else {
      console.log(`  ✓ No changes in ${department}`);
    }
  }
  
  // Save updated hashes
  saveHashCache(newHashes);
  
  return changedDepartments;
}

// Main watch function
async function watchTimetables() {
  console.log('🔍 Timetable Change Watcher Started');
  console.log(`   Check interval: ${CHECK_INTERVAL / 1000} seconds`);
  console.log(`   Watching ${Object.keys(TIMETABLE_URLS).length} departments`);
  console.log('   Press Ctrl+C to stop\n');
  
  // Initial check
  const initialChanges = await checkForChanges();
  
  if (initialChanges.length > 0) {
    console.log(`\n🚀 Changes detected in: ${initialChanges.join(', ')}`);
    
    // Option 1: Run only changed scrapers
    for (const dept of initialChanges) {
      runDepartmentScraper(dept);
    }
    
    // Option 2: Uncomment below to run ALL scrapers when ANY change is detected
    // runAllScrapers();
  }
  
  // Set up interval for continuous monitoring
  setInterval(async () => {
    const changes = await checkForChanges();
    
    if (changes.length > 0) {
      console.log(`\n🚀 Changes detected in: ${changes.join(', ')}`);
      
      // Run scraper for each changed department
      for (const dept of changes) {
        runDepartmentScraper(dept);
      }
      
      // Uncomment below to run ALL scrapers when ANY change is detected
      // runAllScrapers();
    }
  }, CHECK_INTERVAL);
}

// Single check mode (for cron jobs)
async function singleCheck() {
  console.log('🔍 Running single timetable change check...');
  
  const changes = await checkForChanges();
  
  if (changes.length > 0) {
    console.log(`\n🚀 Changes detected in: ${changes.join(', ')}`);
    runAllScrapers();
    return true;
  } else {
    console.log('\n✓ No changes detected');
    return false;
  }
}

// CLI handling
const args = process.argv.slice(2);

if (args.includes('--single') || args.includes('-s')) {
  // Single check mode
  singleCheck().then(changed => {
    process.exit(changed ? 0 : 0);
  });
} else if (args.includes('--run-all')) {
  // Run all scrapers regardless of changes
  checkForChanges().then(() => {
    runAllScrapers();
  });
} else {
  // Continuous watch mode (default)
  watchTimetables();
}

module.exports = { checkForChanges, singleCheck, watchTimetables };
