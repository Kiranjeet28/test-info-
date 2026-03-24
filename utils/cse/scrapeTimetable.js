const axios = require('axios');
const cheerio = require('cheerio');

const TIMETABLE_URLS = require('../timetableUrls');
const CSE_URL = TIMETABLE_URLS.cse;

function isLabSubject(subject) {
  if (!subject) return false;
  const trimmed = subject.trim();
  return trimmed.endsWith(' P') || trimmed.startsWith('(P)');
}

// Helper to check if subject ends with T (Tutorial)
function isTutSubject(subject) {
  if (!subject) return false;
  const trimmed = subject.trim();
  // Check if subject name ends with 'T' (indicating Tutorial)
  return trimmed.endsWith(' T');
}

// Helper to check if subject is Minor Project (MNP) or Major Project (MJP) and normalize it
function normalizeProjectSubject(data) {
  if (!data.subject) return;
  const trimmed = data.subject.trim().toUpperCase();
  // Check for MNP MNP (Minor Project) or MJP MJP (Major Project)
  if (trimmed === 'MNP MNP' || trimmed === 'MJP MJP' || trimmed === 'MNP' || trimmed === 'MJP') {
    data.teacher = null;
    if (trimmed.includes('MNP')) {
      data.subject = 'Minor Project';
    } else if (trimmed.includes('MJP')) {
      data.subject = 'Major Project';
    }
  }
}

// Helper to add Lab and Tut fields to data object
function addLabAndTutFields(data) {
  // For single subject classes
  if (data.subject) {
    data.Lab = isLabSubject(data.subject);
    data.Tut = isTutSubject(data.subject);
    data.OtherDepartment = false;
    
    // If it's a project (MNP or MJP), normalize subject name and set teacher to null
    normalizeProjectSubject(data);
  }
  
  // For classes with entries (elective/lab groups)
  if (data.entries && Array.isArray(data.entries)) {
    // Check if ALL entries are lab subjects (end with P or start with L/(L))
    const allAreLabs = data.entries.every(entry => isLabSubject(entry.subject));
    // Check if ALL entries are tutorial subjects (start with T)
    const allAreTuts = data.entries.every(entry => isTutSubject(entry.subject));
    
    if (allAreLabs) {
      // If all are labs, set elective to false and Lab to true at outer level
      data.elective = false;
      data.Lab = true;
      data.Tut = false;
    } else if (allAreTuts) {
      // If all are tutorials, set elective to false and Tut to true at outer level
      data.elective = false;
      data.Lab = false;
      data.Tut = true;
      
      // If only 1 entry in Tut, flatten the structure (no need for array)
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
    // Don't add Lab/Tut fields inside individual entries
  }
  
  // Mark as OtherDepartment when: elective=false, freeClass=false, entries=null, and no Lab/Tut
  if (data.elective === false && data.freeClass === false && data.entries === null && !data.Lab && !data.Tut) {
    data.Lab = false;
    data.Tut = false;
    data.OtherDepartment = true;
  }
  
  // Ensure OtherDepartment is false for free classes
  if (data.freeClass === true) {
    data.OtherDepartment = false;
  }
  
  return data;
}

// Helper to transform section name like "D2 CS A" to ["D2A1", "D2A2", ...] based on max subgroups
function transformSectionName(yearSec, maxSubgroups = 2) {
  // Match pattern like "D2 CS A", "D3 CS B", etc.
  const match = yearSec.match(/^(D\d+)\s+CS\s+([A-Z])$/i);
  if (match) {
    const year = match[1].toUpperCase();
    const section = match[2].toUpperCase();
    const subgroups = [];
    for (let i = 1; i <= maxSubgroups; i++) {
      subgroups.push(`${year}${section}${i}`);
    }
    return subgroups;
  }
  return [yearSec]; // Return original if doesn't match pattern
}

// Helper to find maximum number of entries in Lab/Tut classes
function findMaxSubgroups(classes) {
  let maxEntries = 2; // Default minimum of 2 subgroups
  
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

// Helper to filter entries by exact subgroup match for CSE
function filterEntriesBySubgroup(classes, subgroup) {
  // Extract the subgroup number from the end (supports any number: 1, 2, 3, 4, ...)
  const subgroupMatch = subgroup.match(/(\d+)$/);
  if (!subgroupMatch) return classes;
  
  const subgroupNum = parseInt(subgroupMatch[1]);
  const entryIndex = subgroupNum - 1; // Convert to 0-based index
  
  return classes.map(classItem => {
    const data = classItem.data;
    
    // Only filter if Lab or Tut is true and there are entries
    if ((data.Lab || data.Tut) && data.entries && Array.isArray(data.entries)) {
      let finalEntries = [];
      
      // Filter entries to only include the one matching the exact subgroup index
      if (entryIndex >= 0 && entryIndex < data.entries.length) {
        finalEntries = [data.entries[entryIndex]];
      } else if (data.entries.length > 0) {
        // If subgroup index exceeds entries, keep empty or last available
        // This handles cases where some slots have fewer groups
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

async function scrapeCseTimetable(url = CSE_URL) {
  const { data: html } = await axios.get(url);
  const $ = cheerio.load(html);
  const result = {};
  const fs = require('fs');
  const path = require('path');
  const groupPath = path.join(__dirname, '../../../web/group/cse.json');
  let existingGroups = [];
  // Read existing groups if file exists
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
    const yearSec = $(table).find('thead tr:first-child th[colspan]').text().trim();
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

    // Only CSE logic
    const maxSubgroups = findMaxSubgroups(classes);
    const sectionNames = transformSectionName(yearSec, maxSubgroups);
    sectionNames.forEach(sectionName => {
      let groupClasses = [];
      if (sectionNames.length > 1) {
        groupClasses = filterEntriesBySubgroup(JSON.parse(JSON.stringify(classes)), sectionName);
        result[sectionName] = { classes: groupClasses };
      } else {
        groupClasses = JSON.parse(JSON.stringify(classes));
        result[sectionName] = { classes: groupClasses };
      }

      // Check if all classes are free for this group
      const allFree = groupClasses.every(cls => {
        if (cls && cls.data && typeof cls.data.freeClass === 'boolean') {
          return cls.data.freeClass === true;
        }
        return false;
      });

      // Only add group if not all classes are free
      if (!allFree && !existingGroups.includes(sectionName)) {
        existingGroups.push(sectionName);
        fs.mkdirSync(path.dirname(groupPath), { recursive: true });
        fs.writeFileSync(groupPath, JSON.stringify(existingGroups, null, 2));
      }
    });
  });
  return result;
}

function parseCell($, cell) {
  const $cell = $(cell);
  const html = $cell.html() || '';

  // Elective / nested table detection first
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

  // Free class detection
  const plainText = $cell.text().trim();
  if (/^(?:-x-|---|\s*)$/i.test(plainText) || !html.includes('<br')) {
    return { subject: null, teacher: null, classRoom: null, elective: false, freeClass: true };
  }

  // Normal class
  const parts = html
    .split(/<br\s*\/?\>/i)
    .map((v) => cheerio.load(v).text().trim())
    .filter(Boolean);

  // Check if any part contains MJP MJP or MNP MNP (Project)
  const projectIndex = parts.findIndex(p => {
    const upper = p.toUpperCase();
    return upper === 'MJP MJP' || upper === 'MNP MNP' || upper === 'MJP' || upper === 'MNP';
  });
  
  if (projectIndex !== -1) {
    // Found a project - handle different structures
    // Structure could be: [groups, MJP/MNP, teachers, room] or [MJP/MNP, teachers, room]
    const projectPart = parts[projectIndex];
    const isMinor = projectPart.toUpperCase().includes('MNP');
    const subject = isMinor ? 'Minor Project' : 'Major Project';
    
    // Room is typically the last part
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

async function scrapeCseAndSave(url = CSE_URL) {
  const timetable = await scrapeCseTimetable(url);
  const fs = require('fs');
  const path = require('path');
  const groupPath = path.join(__dirname, '../../../web/group/cse.json');
  try {
    if (!timetable || typeof timetable !== 'object') {
      console.error('Timetable is invalid:', timetable);
      return { url, timetable };
    }
    const groupNames = Object.keys(timetable);
    fs.mkdirSync(path.dirname(groupPath), { recursive: true });
    fs.writeFileSync(groupPath, JSON.stringify(groupNames, null, 2));
  } catch (err) {
    console.error('Failed to write CSE group info:', err.message);
  }
  return { url, timetable };
}

module.exports = { scrapeCseTimetable, scrapeCseAndSave };

// Run scraper if executed directly
if (require.main === module) {
  scrapeCseAndSave()
    .then(({ url, timetable }) => {
      console.log('Scraping complete. Timetable saved for CSE groups.');
      const fs = require('fs');
      const path = require('path');
      const timetablePath = path.join(__dirname, '../../../public/timetable_cse.json');
      fs.mkdirSync(path.dirname(timetablePath), { recursive: true });
      fs.writeFileSync(timetablePath, JSON.stringify({ url, timetable }, null, 2));
      console.log(`Timetable saved to ${timetablePath}`);

      const webTimetablePath = path.join(__dirname, '../../../web/timetable_cse.json');
      fs.mkdirSync(path.dirname(webTimetablePath), { recursive: true });
      fs.writeFileSync(webTimetablePath, JSON.stringify({ url, timetable }, null, 2));
      console.log(`Timetable also saved to ${webTimetablePath}`);
    })
    .catch(err => {
      console.error('Error scraping CSE timetable:', err);
    });
}