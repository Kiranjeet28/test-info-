const axios = require('axios');
const cheerio = require('cheerio');

const TIMETABLE_URLS = require('../timetableUrls');
const APPLIED_SCIENCE_URL = TIMETABLE_URLS.appliedscience;

function isLabSubject(subject) {
  if (!subject) return false;
  const trimmed = subject.trim();
  return trimmed.endsWith(' P') || trimmed.startsWith('(P)');
}

function isTutSubject(subject) {
  if (!subject) return false;
  const trimmed = subject.trim();
  return trimmed.endsWith(' T');
}

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

async function scrapeAppliedScienceTimetable(url = APPLIED_SCIENCE_URL) {
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);
  const result = {};
  const fs = require('fs');
  const path = require('path');
  const groupPath = path.join(__dirname, '../../../web/group/appliedscience.json');
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
  // Some timetables use a div-based structure instead of <br>, e.g.:
  // <div class="line1"><span class="subject"><span class="s_3">CHEMISTRY</span></span><span class="activitytag"><span class="at_3">P</span></span></div>
  // <div class="teacher line2"><span class="t_12">KARAN BHALLA</span></div>
  // <div class="room line3"><span class="r_41">CHEM LAB</span></div>
  const subjectEl = $cell.find('.line1 .subject').first();
  if (subjectEl.length) {
    let subject = subjectEl.text().trim() || null;
    const activityEl = $cell.find('.activitytag').first();
    const activity = activityEl.length ? activityEl.text().trim() : null;
    // Append activity tag to subject so addLabAndTutFields can detect Lab/Tut
    if (subject && activity) {
      // normalize single-letter tags (P, L, T) to a trailing marker
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
    .split(/<br\s*\/?/i)
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

async function scrapeAppliedScienceAndSave(url = APPLIED_SCIENCE_URL) {
  const timetable = await scrapeAppliedScienceTimetable(url);
  const fs = require('fs');
  const path = require('path');
  const groupPath = path.join(__dirname, '../../../web/group/appliedscience.json');
  const timetablePath = path.join(__dirname, '../../../public/timetable_appliedscience.json');
  try {
    if (!timetable || typeof timetable !== 'object') {
      console.error('Timetable is invalid:', timetable);
      return { url, timetable };
    }
    const groupNames = Object.keys(timetable);
    fs.mkdirSync(path.dirname(groupPath), { recursive: true });
    fs.writeFileSync(groupPath, JSON.stringify(groupNames, null, 2));
    // Save the full timetable to public/timetable_appliedscience.json
    fs.mkdirSync(path.dirname(timetablePath), { recursive: true });
    fs.writeFileSync(timetablePath, JSON.stringify({ url, timetable }, null, 2));

    // Also save a copy to web/timetable_appliedscience.json
    const webTimetablePath = path.join(__dirname, '../../../web/timetable_appliedscience.json');
    fs.mkdirSync(path.dirname(webTimetablePath), { recursive: true });
    fs.writeFileSync(webTimetablePath, JSON.stringify({ url, timetable }, null, 2));
  } catch (err) {
    console.error('Failed to write Applied Science group or timetable info:', err.message);
  }
  return { url, timetable };
}

module.exports = { scrapeAppliedScienceTimetable, scrapeAppliedScienceAndSave };

if (require.main === module) {
  scrapeAppliedScienceAndSave()
    .then(({ url, timetable }) => {
      console.log('Scraping complete. Timetable saved for Applied Science groups.');
    })
    .catch(err => {
      console.error('Error scraping Applied Science timetable:', err);
    });
}
