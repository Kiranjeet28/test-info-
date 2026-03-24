const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const TIMETABLE_URLS = require('../timetableUrls');
const CIVIL_URL = TIMETABLE_URLS.civil;



function parseCell($, cell) {
  const $cell = $(cell);
  const html = $cell.html() || '';
  // Handle div-based structure first (line1/line2/line3 + activitytag)
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
    return {
      subject,
      teacher,
      classRoom,
      elective: false,
      freeClass: !subject,
      Lab: /\bP\b|\bL\b|LAB/i.test(subject || ''),
      Tut: /\bT\b/i.test(subject || ''),
      OtherDepartment: false
    };
  }

  let text = html || '';
  if ($cell.hasClass('empty') || !text.trim()) {
    return {
      subject: null,
      teacher: null,
      classRoom: null,
      elective: false,
      freeClass: true,
      Lab: false,
      Tut: false,
      OtherDepartment: false
    };
  }
  // Split by <br> and clean
  const lines = text
    .split('<br>')
    .map(line => line.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  return {
    subject: lines[0] || null,
    teacher: lines[1] || null,
    classRoom: lines[2] || null,
    elective: false,
    freeClass: !lines[0],
    Lab: /\bP\b|LAB/i.test(lines[0] || ''),
    Tut: /\bT\b/i.test(lines[0] || ''),
    OtherDepartment: false
  };
}


async function scrapeCivilTimetable(url = CIVIL_URL) {
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);
  // Dynamically fetch group names and table IDs from the page
  const result = {};
  const groups = [];
  $('ul > li > ul > li > a').each((_, a) => {
    const groupName = $(a).text().trim();
    const tableId = $(a).attr('href').substring(1);
    groups.push({
      name: groupName,
      tableId: tableId
    });
  });
  // For each group found on the page, process its table
  for (const group of groups) {
    const table = $("#" + group.tableId);
    if (table.length === 0) {
      result[group.name] = { classes: [] };
      continue;
    }
    const classes = [];
    const xAxis = [];
    table.find('thead tr:first-child th.xAxis').each((_, th) => {
      xAxis.push($(th).text().trim());
    });
    table.find('tbody tr').each((rowIndex, row) => {
      if ($(row).hasClass('foot')) return;
      const yAxisCell = $(row).find('th.yAxis');
      if (!yAxisCell.length) return;
      const rawTime = yAxisCell.first().text().trim();
      if (!rawTime) return;
      const m = rawTime.match(/^(\d{1,2})[:.](\d{2})$/);
      const timeOfClass = m ? (parseInt(m[1], 10) >= 1 && parseInt(m[1], 10) <= 6 ? `${String(parseInt(m[1],10)+12).padStart(2,'0')}:${m[2]}` : rawTime) : rawTime;
      $(row).children('td').each((colIndex, td) => {
        const dayOfClass = xAxis[colIndex];
        if (!dayOfClass) return;
        const data = parseCell($, td);
        classes.push({
          dayOfClass,
          timeOfClass,
          data
        });
      });
    });
    result[group.name] = { classes };
  }
  return result;
}

async function scrapeCivilAndSave(url = CIVIL_URL) {
  const timetableRaw = await scrapeCivilTimetable(url);
  // No need to update group file, groups are fetched dynamically
  // Standardize time format to match other departments
  const TIME_MAP = {
    '8.30 AM (1ST)': '08:30',
    '9.30 AM (2ND)': '09:30',
    '10.30 AM (3RD)': '10:30',
    '11.30 AM (4TH)': '11:30',
    '12.30 PM (5TH)': '12:30',
    '1.30 PM (6TH)': '13:30',
    '2.30 PM (7TH)': '14:30',
    '3.30 PM (8TH)': '15:30'
  };
  const timetable = {};
  for (const group of Object.keys(timetableRaw)) {
    timetable[group] = {
      classes: (timetableRaw[group].classes || []).map(cls => ({
        ...cls,
        timeOfClass: TIME_MAP[cls.timeOfClass] || cls.timeOfClass
      }))
    };
  }
  // Write group names to civil.json
  const groupPath = path.join(__dirname, '../../../web/group/civil.json');
  try {
    const groupNames = Object.keys(timetable);
    fs.mkdirSync(path.dirname(groupPath), { recursive: true });
    fs.writeFileSync(groupPath, JSON.stringify(groupNames, null, 2));
  } catch (err) {
    console.error('Failed to write Civil group info:', err.message);
  }
  return {
    url,
    timetable
  };
}

module.exports = {
  scrapeCivilTimetable,
  scrapeCivilAndSave
};

if (require.main === module) {
  scrapeCivilAndSave()
    .then(({ url, timetable }) => {
      console.log('Scraping complete. Timetable saved for Civil groups.');
      const timetablePath = path.join(__dirname, '../../../public/timetable_civil.json');
      fs.writeFileSync(timetablePath, JSON.stringify({ url, timetable }, null, 2));
      console.log(`Timetable saved to ${timetablePath}`);

      const webTimetablePath = path.join(__dirname, '../../../web/timetable_civil.json');
      fs.writeFileSync(webTimetablePath, JSON.stringify({ url, timetable }, null, 2));
      console.log(`Timetable also saved to ${webTimetablePath}`);
    })
    .catch(err => {
      console.error('Error scraping Civil timetable:', err);
    });
}