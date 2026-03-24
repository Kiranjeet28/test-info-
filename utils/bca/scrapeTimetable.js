const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const TIMETABLE_URLS = require('../timetableUrls');
const BCA_URL = TIMETABLE_URLS.bca;

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

function normalizeProjectSubject(data) {
  if (!data.subject) return;
  const trimmed = data.subject.trim().toUpperCase();
  if (trimmed === 'MNP MNP' || trimmed === 'MJP MJP' || trimmed === 'MNP' || trimmed === 'MJP') {
    data.teacher = null;
    if (trimmed.includes('MNP')) {
      data.subject = 'Minor Project';
    } else if (trimmed.includes('MJP')) {
      data.subject = 'Major Project';
    }
  }
}

function addLabAndTutFields(data) {
  if (data.subject) {
    data.Lab = isLabSubject(data.subject);
    data.Tut = isTutSubject(data.subject);
    data.OtherDepartment = false;
    normalizeProjectSubject(data);
  }
  if (data.entries && Array.isArray(data.entries)) {
    const allAreLabs = data.entries.every(entry => isLabSubject(entry.subject));
    const allAreTuts = data.entries.every(entry => isTutSubject(entry.subject));
    if (allAreLabs) {
      data.elective = false;
      data.Lab = true;
      data.Tut = false;
        if (data.entries.length === 1) {
          const entry = data.entries[0];
          data.subject = entry.subject;
          data.teacher = entry.teacher || null;
          data.classRoom = entry.classRoom || null;
          data.entries = null;
        }
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

function transformSectionName(yearSec, maxSubgroups = 2) {
  const match = yearSec.match(/^(BCA\d+)\s*-?\s*([A-Z])$/i);
  if (match) {
    const year = match[1].toUpperCase();
    const section = match[2].toUpperCase();
    const subgroups = [];
    for (let i = 1; i <= maxSubgroups; i++) {
      subgroups.push(`${year}-${section}${i}`);
    }
    return subgroups;
  }
  return [yearSec];
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

function findMaxSubgroups(classes) {
  let maxEntries = 2;
  for (const classItem of classes) {
    const data = classItem.data;
    if ((data.Lab || data.Tut) && data.entries && Array.isArray(data.entries)) {
      if (data.entries.length > maxEntries) {
        maxEntries = data.entries.length;
      }
    }
  }
  return maxEntries;
}

function filterEntriesBySubgroup(classes, subgroup) {
  const subgroupMatch = subgroup.match(/(\d+)$/);
  if (!subgroupMatch) return classes;
  const subgroupNum = parseInt(subgroupMatch[1]);
  const entryIndex = subgroupNum - 1;
  return classes.map(classItem => {
    const data = classItem.data;
    if ((data.Lab || data.Tut) && data.entries && Array.isArray(data.entries)) {
      let finalEntries = [];
      if (entryIndex >= 0 && entryIndex < data.entries.length) {
        finalEntries = [data.entries[entryIndex]];
      } else if (data.entries.length > 0) {
        finalEntries = [];
      }
      return {
        ...classItem,
        data: {
          ...data,
          entries: finalEntries
        }
      };
    }
    return classItem;
  });
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
      const last = rows.slice(-4);
      for (let ci = 0; ci < colCount; ci++) {
        const subject = (last[last.length - 3] && last[last.length - 3][ci]) || null;
        const teacher = (last[last.length - 2] && last[last.length - 2][ci]) || null;
        const classRoom = (last[last.length - 1] && last[last.length - 1][ci]) || null;
        if (subject || teacher || classRoom) entries.push({ subject, teacher, classRoom });
      }
    }
    return { elective: true, freeClass: false, entries };
  }
  const plainText = $cell.text().trim();
  if (/^(?:-x-|---|\s*)$/i.test(plainText) || !html.includes('<br')) {
    return { subject: null, teacher: null, classRoom: null, elective: false, freeClass: true };
  }
  const parts = html
    .split(/<br\s*\/?>/i)
    .map((v) => cheerio.load(v).text().trim())
    .filter(Boolean);
  const projectIndex = parts.findIndex(p => {
    const upper = p.toUpperCase();
    return upper === 'MJP MJP' || upper === 'MNP MNP' || upper === 'MJP' || upper === 'MNP';
  });
  if (projectIndex !== -1) {
    const projectPart = parts[projectIndex];
    const isMinor = projectPart.toUpperCase().includes('MNP');
    const subject = isMinor ? 'Minor Project' : 'Major Project';
    const classRoom = parts[parts.length - 1] || null;
    return { subject, teacher: null, classRoom, elective: false, freeClass: false };
  }
  if (parts.length === 3) {
    return { subject: parts[0], teacher: parts[1], classRoom: parts[2], elective: false, freeClass: false };
  }
  const entries = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i + 2]) entries.push({ subject: parts[i], teacher: parts[i + 1], classRoom: parts[i + 2] });
  }
  return { elective: entries.length > 1, freeClass: false, entries: entries.length > 1 ? entries : null };
}

async function scrapeBcaTimetable(url = BCA_URL) {
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);
  const timetable = {};
  const groupPath = path.join(__dirname, '../../../web/group/bca.json');
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
  $('table').each((_, table) => {
    const yearSec = $(table).find('caption .name').text().trim();
    if (!yearSec) return;
    const classes = [];
    const xAxis = [];
    $(table)
      .find('thead tr')
      .last()
      .find('th.xAxis')
      .each((_, th) => {
        xAxis.push($(th).text().trim());
      });
    $(table).find('tbody tr').each((_, row) => {
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
    const maxSubgroups = findMaxSubgroups(classes);
    const sectionNames = transformSectionName(yearSec, maxSubgroups);
    sectionNames.forEach(sectionName => {
      let groupClasses = [];
      if (sectionNames.length > 1) {
        groupClasses = filterEntriesBySubgroup(JSON.parse(JSON.stringify(classes)), sectionName);
        timetable[sectionName] = { classes: groupClasses };
      } else {
        groupClasses = JSON.parse(JSON.stringify(classes));
        timetable[sectionName] = { classes: groupClasses };
      }
      const allFree = groupClasses.every(cls => {
        if (cls && cls.data && typeof cls.data.freeClass === 'boolean') {
          return cls.data.freeClass === true;
        }
        return false;
      });
      if (!allFree && !existingGroups.includes(sectionName)) {
        existingGroups.push(sectionName);
        fs.mkdirSync(path.dirname(groupPath), { recursive: true });
        fs.writeFileSync(groupPath, JSON.stringify(existingGroups, null, 2));
      }
    });
  });
  return { url, timetable };
}

async function scrapeBcaAndSave(url = BCA_URL) {
  const result = await scrapeBcaTimetable(url);
  const groupPath = path.join(__dirname, '../../../web/group/bca.json');
  const timetablePath = path.join(__dirname, '../../../public/timetable_bca.json');
  const webTimetablePath = path.join(__dirname, '../../../web/timetable_bca.json');
  try {
    const { url: sourceUrl, timetable } = result || {};
    if (!timetable || typeof timetable !== 'object') {
      console.error('Timetable is invalid:', result);
      return result;
    }
    const groupNames = Object.keys(timetable);
    fs.mkdirSync(path.dirname(groupPath), { recursive: true });
    fs.writeFileSync(groupPath, JSON.stringify(groupNames, null, 2));

    // Save the full timetable to public/timetable_bca.json
    fs.mkdirSync(path.dirname(timetablePath), { recursive: true });
    fs.writeFileSync(timetablePath, JSON.stringify({ url: sourceUrl, timetable }, null, 2));

    // Also save a copy to web/timetable_bca.json
    fs.mkdirSync(path.dirname(webTimetablePath), { recursive: true });
    fs.writeFileSync(webTimetablePath, JSON.stringify({ url: sourceUrl, timetable }, null, 2));
  } catch (err) {
    console.error('Failed to write BCA group or timetable info:', err.message);
  }
  return result;
}


// Export BCA groups directly from this file
const bcaGroupPath = path.join(__dirname, '../../../web/group/bca.json');
let bcaGroups = [];
try {
  const content = fs.readFileSync(bcaGroupPath, 'utf8');
  bcaGroups = JSON.parse(content);
  if (!Array.isArray(bcaGroups)) bcaGroups = [];
} catch (e) {
  bcaGroups = [];
}

module.exports = { scrapeBcaTimetable, scrapeBcaAndSave, bcaGroups };

if (require.main === module) {
  scrapeBcaAndSave()
    .then(({ url, timetable }) => {
      console.log('Scraping complete. Timetable saved for BCA groups.');
    })
    .catch(err => {
      console.error('Error scraping BCA timetable:', err);
    });
}
