// runAllTimetables.js
// Script to run all timetable scraping scripts in the utils folder

const { execSync } = require('child_process');
const path = require('path');

const scripts = [
  'appliedscience/scrapeTimetable.js',
  'bca/scrapeTimetable.js',
  'civil/scrapeTimetable.js',
  'cse/scrapeTimetable.js',
  'ece/scrapeTimetable.js',
  'electrical/scrapeTimetable.js',
  'it/scrapeTimetable.js',
  'mechanical/scrapeTimetable.js',
  'cse/scrapeTimetable.js'
];


const results = [];
for (const script of scripts) {
  const scriptPath = path.join(__dirname, script);
  try {
    console.log(`\nRunning: ${script}`);
    execSync(`node ${scriptPath}`, { stdio: 'inherit' });
    results.push({ script, status: 'success' });
  } catch (err) {
    console.error(`Error running ${script}:`, err.message);
    results.push({ script, status: 'error', error: err.message });
  }
}

console.log('\n--- Timetable Scraping Summary ---');
for (const result of results) {
  if (result.status === 'success') {
    console.log(`✔️  ${result.script} completed successfully.`);
  } else {
    console.log(`❌  ${result.script} failed: ${result.error}`);
  }
}
