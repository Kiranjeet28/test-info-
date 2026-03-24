const axios = require('axios');
const cheerio = require('cheerio');

// IT Department URL only
const TIMETABLE_URLS = require('../timetableUrls');
const IT_URL = TIMETABLE_URLS.it;

// Helper to check if subject is a Lab
function isLabSubject(subject) {
  if (!subject) return false;
  const trimmed = subject.trim();
  return trimmed.endsWith(' P') || trimmed.startsWith('(P)');
}

// Helper to check if subject is a Tutorial
function isTutSubject(subject) {
  if (!subject) return false;
  const trimmed = subject.trim();
  return trimmed.endsWith(' T');
}

// Helper to add Lab and Tut fields
function addLabAndTutFields(data) {
  if (data.subject) {
    data.Lab = isLabSubject(data.subject);
    data.Tut = isTutSubject(data.subject);
    data.OtherDepartment = false;
  }
  if (data.entries && Array.isArray(data.entries)) {
    const allAreLabs = data.entries.every(entry => isLabSubject(entry.subject));
    const allAreTuts = data.entries.every(entry => isTutSubject(entry.subject));
    if (allAreLabs) {
      data.elective = false;
      data.Lab = true;
      data.Tut = false;
    } else if (allAreTuts) {
      data.elective = false;
      data.Lab = false;
      data.Tut = true;
      if (data.entries.length === 1) {
        const entry = data.entries[0];
        data.subject = entry.subject;
        data.teacher = entry.teacher;
        data.classRoom = entry.classRoom;
        data.entries = null;
      }
    } else {
      data.Lab = false;
      data.Tut = false;
    }
    data.OtherDepartment = false;
  }
  if (data.elective === false && data.freeClass === false && data.entries === null && !data.Lab && !data.Tut) {
    data.Lab = false;
    data.Tut = false;
    data.OtherDepartment = true;
  }
  if (data.freeClass === true) {
    data.OtherDepartment = false;
  }
  return data;
}

// Helper to extract group names and table ids from the group list
function extractGroups($) {
  const groups = [];
  $('ul li a[href^="#table_"]').each((_, a) => {
    const href = $(a).attr('href');
    const name = $(a).text().trim();
    if (href && name) {
      groups.push({ id: href.replace('#', ''), name });
    }
  });
  return groups;
}

// Convert time like "08:30" or "1:30" to minutes since midnight.
function timeStrToMinutes(t) {
  if (!t) return Infinity;
  const m = ('' + t).match(/(\d{1,2}):(\d{2})/);
  if (!m) return Infinity;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  // Treat early-hour single-digit times (1-6) as afternoon (13-18)
  // so that "1:30" becomes 13:30 and compares correctly against 12:30 cutoff.
  if (h >= 1 && h <= 6) h += 12;
  return h * 60 + min;
}

// Normalize a time string like "1:30" -> "13:30" for afternoon slots
function normalizeTime(t) {
  if (!t) return t;
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return s;
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (h >= 1 && h <= 6) h += 12;
  return `${String(h).padStart(2, '0')}:${min}`;
}

// Parse a single schedule table element into JSON.
// Stops collecting rows once time passes 12:30 (inclusive up to 12:30).
function parseScheduleTable($, table) {
  const result = { name: null, institution: null, classes: [] };
  const caption = $(table).find('caption').first();
  if (caption.length) {
    result.institution = caption.find('.institution').text().trim() || null;
    result.name = caption.find('.name').text().trim() || caption.text().trim() || null;
  }

  const xAxis = [];
  $(table).find('thead tr').last().find('th.xAxis').each((_, th) => {
    xAxis.push($(th).text().trim());
  });

  $(table).find('tbody tr').each((_, row) => {
    const yAxisCell = $(row).find('th.yAxis');
    if (!yAxisCell.length) return;
    const rawTime = yAxisCell.text().trim();
    if (!rawTime) return;
    const timeOfClass = normalizeTime(rawTime);
    // no cutoff: parse all rows including 1:30 and later

    const tds = $(row).children('td');
    tds.each((colIndex, td) => {
      const dayOfClass = xAxis[colIndex];
      if (!dayOfClass) return;
      const data = addLabAndTutFields(parseCell($, td));
      result.classes.push({ dayOfClass, timeOfClass, data });
    });
  });
  return result;
}

// Main scraping function for IT timetable
async function scrapeItTimetable(url = IT_URL) {
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);
  const result = {};
  const fs = require('fs');
  const path = require('path');
  const groupPath = path.join(__dirname, '../../../web/group/it.json');
  let existingGroups = [];
  if (fs.existsSync(groupPath)) {
    try {
      const content = fs.readFileSync(groupPath, 'utf8');
      existingGroups = JSON.parse(content);
      if (!Array.isArray(existingGroups)) existingGroups = [];
    } catch (e) {
      existingGroups = [];
    }
  }

  const groups = extractGroups($);
  groups.forEach(group => {
    const table = $(`table#${group.id}`);
    if (!table.length) return;
    const classes = [];
    const xAxis = [];
    table.find('thead tr').last().find('th.xAxis').each((_, th) => {
      xAxis.push($(th).text().trim());
    });
    table.find('tbody tr').each((_, row) => {
      const yAxisCell = $(row).find('th.yAxis');
      if (!yAxisCell.length) return;
        const rawTime = yAxisCell.text().trim();
        if (!rawTime) return;
        const timeOfClass = normalizeTime(rawTime);
      const tds = $(row).children('td');
      tds.each((colIndex, td) => {
        const dayOfClass = xAxis[colIndex];
        if (!dayOfClass) return;
        const data = addLabAndTutFields(parseCell($, td));
        classes.push({ dayOfClass, timeOfClass, data });
      });
    });
    result[group.name] = { classes };
    if (!existingGroups.includes(group.name)) {
      existingGroups.push(group.name);
      fs.mkdirSync(path.dirname(groupPath), { recursive: true });
      fs.writeFileSync(groupPath, JSON.stringify(existingGroups, null, 2));
    }
  });
  return result;
}

function parseCell($, cell) {
  const $cell = $(cell);
  const html = $cell.html() || '';
  const innerTable = $cell.find('table.detailed, table');
  if (innerTable.length) {
    const rows = [];
    innerTable.find('tbody tr').each((ri, r) => {
      const cols = [];
      $(r).find('td, th').each((ci, c) => {
        cols.push($(c).text().trim());
      });
      rows.push(cols);
    });
    const entries = [];
    const colCount = rows[0] ? rows[0].length : 0;
    if (colCount > 0) {
      const last = rows.slice(-3);
      for (let ci = 0; ci < colCount; ci++) {
        const subject = (last[last.length - 3] && last[last.length - 3][ci]) || null;
        const teacher = (last[last.length - 2] && last[last.length - 2][ci]) || null;
        const classRoom = (last[last.length - 1] && last[last.length - 1][ci]) || null;
        if (subject || teacher || classRoom) entries.push({ subject, teacher, classRoom });
      }
    }
    return { elective: true, freeClass: false, entries };
  }
  // Handle div-based cell structure used in some timetables:
  // <div class="line1"><span class="subject"><span class="s_3">CHEMISTRY</span></span><span class="activitytag"><span class="at_3">P</span></span></div>
  // <div class="teacher line2"><span class="t_12">KARAN BHALLA</span></div>
  // <div class="room line3"><span class="r_41">CHEM LAB</span></div>
  const subjectEl = $cell.find('.line1 .subject').first();
  if (subjectEl.length) {
    let subject = subjectEl.text().trim() || null;
    const activityEl = $cell.find('.activitytag').first();
    const activity = activityEl.length ? activityEl.text().trim() : null;
    if (subject && activity) {
      const act = activity.replace(/[^A-Za-z]/g, '').toUpperCase();
      if (act) subject = `${subject} ${act}`;
    }
    const teacher = $cell.find('.line2').text().trim() || null;
    const classRoom = $cell.find('.line3').text().trim() || null;
    if (!subject && !teacher && !classRoom) {
      return { subject: null, teacher: null, classRoom: null, elective: false, freeClass: true };
    }
    return { subject, teacher, classRoom, elective: false, freeClass: false };
  }

  const plainText = $cell.text().trim();
  if (/^(?:-x-|---|\s*)$/i.test(plainText) || !html.includes('<br')) {
    return { subject: null, teacher: null, classRoom: null, elective: false, freeClass: true };
  }
  const parts = html
    .split(/<br\s*\/?>/i)
    .map((v) => cheerio.load(v).text().trim())
    .filter(Boolean);
  if (parts.length === 3) {
    return { subject: parts[0], teacher: parts[1], classRoom: parts[2], elective: false, freeClass: false };
  }
  const entries = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i + 2]) entries.push({ subject: parts[i], teacher: parts[i + 1], classRoom: parts[i + 2] });
  }
  return { elective: entries.length > 1, freeClass: false, entries: entries.length > 1 ? entries : null };
}

async function scrapeItAndSave(url = IT_URL) {
  const timetable = await scrapeItTimetable(url);
  const fs = require('fs');
  const path = require('path');
  const groupPath = path.join(__dirname, '../../../web/group/it.json');
  const timetablePath = path.join(__dirname, '../../../public/timetable_it.json');
  try {
    if (!timetable || typeof timetable !== 'object') {
      console.error('Timetable is invalid:', timetable);
      return { url, timetable };
    }
    const groupNames = Object.keys(timetable);
    fs.mkdirSync(path.dirname(groupPath), { recursive: true });
    fs.writeFileSync(groupPath, JSON.stringify(groupNames, null, 2));
    // Save the full timetable to public/timetable_it.json
    fs.mkdirSync(path.dirname(timetablePath), { recursive: true });
    fs.writeFileSync(timetablePath, JSON.stringify({ url, timetable }, null, 2));

    // Also save a copy to web/timetable_it.json
    const webTimetablePath = path.join(__dirname, '../../../web/timetable_it.json');
    fs.mkdirSync(path.dirname(webTimetablePath), { recursive: true });
    fs.writeFileSync(webTimetablePath, JSON.stringify({ url, timetable }, null, 2));
  } catch (err) {
    console.error('Failed to write IT group or timetable info:', err.message);
  }
  return { url, timetable };
}

module.exports = { scrapeItTimetable, scrapeItAndSave, parseScheduleTable };

if (require.main === module) {
  scrapeItAndSave()
    .then(({ url, timetable }) => {
      console.log('Scraping complete. Timetable saved for IT groups.');
    })
    .catch(err => {
      console.error('Error scraping IT timetable:', err);
    });
}
