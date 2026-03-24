// scrapeTimetable.js for Mechanical Department
// Scrapes the timetable from the provided HTML tables for all mechanical groups
// Usage: node scrapeTimetable.js

const fs = require('fs');
const cheerio = require('cheerio');
const axios = require('axios');

const TIMETABLE_URLS = require('../timetableUrls');
const URL = TIMETABLE_URLS.mechanical;
const OUTPUT_PATH = '../../web/timetable_mechanical.json';
const TIME_SLOTS = [
  '08:30', '09:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30'
];

const path = require('path');
// Group list (will be discovered from page table ids)
const GROUP_LIST_PATH = 'web/group/mechanical.json';

function discoverGroupTableIds($) {
  const ids = new Set();

  // 1) All tables with an id that looks like a timetable table
  $('table[id]').each((i, t) => {
    const id = (t.attribs && t.attribs.id) || '';
    if (!id) return;
    // prefer ids that include 'table', 'timetable' or start with 'table_'
    if (/table|time|timetable/i.test(id)) ids.add('#' + id);
  });

  // 2) Look for anchors or buttons that target table ids (tabs using href or data-target)
  $('[data-target], [data-bs-target], a[href^="#"], button[data-target]').each((i, el) => {
    const $el = $(el);
    const tgt = ($el.attr('data-target') || $el.attr('data-bs-target') || $el.attr('href') || '').trim();
    if (/^#/.test(tgt) && /table|time|timetable/i.test(tgt)) ids.add(tgt);
  });

  // 3) Also check for elements with role=tab that reference panels
  $('[role="tab"]').each((i, el) => {
    const $el = $(el);
    const aria = $el.attr('aria-controls') || '';
    if (aria && /table|time|timetable/i.test(aria)) ids.add('#' + aria);
  });

  return Array.from(ids);
}

function resolveGroupName($, tableSelector) {
  const id = (tableSelector || '').replace(/^#/, '');
  const table = $(tableSelector);

  // 1. caption
  let caption = '';
  try { caption = table.find('caption').text().trim(); } catch (e) { caption = ''; }
  if (caption) return cleanGroupName(caption);

  // 2. elements that target this id (tab labels, anchors, buttons)
  const candidates = [];
  const selectorHash = '#' + id;
  $(`[data-target="${selectorHash}"], [data-bs-target="${selectorHash}"], a[href="${selectorHash}"], button[data-target="${selectorHash}"]`).each((i, el) => {
    const txt = $(el).text().trim();
    if (txt) candidates.push(txt);
  });
  // aria-controls referencing
  $(`[aria-controls="${id}"]`).each((i, el) => {
    const txt = $(el).text().trim();
    if (txt) candidates.push(txt);
  });
  if (candidates.length) {
    // prefer the longest label (often includes group info)
    candidates.sort((a, b) => b.length - a.length);
    return cleanGroupName(candidates[0]);
  }

  // 3. look for preceding headings near the table
  const heading = table.prevAll('h1,h2,h3,h4,h5,h6').first().text().trim();
  if (heading) return cleanGroupName(heading);

  // 4. fallback to id
  return cleanGroupName(id || tableSelector);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

async function fetchHTML(url) {
  const { data } = await axios.get(url);
  return data;
}

function cleanGroupName(raw) {
  // Remove GNDEC prefix and trim
  return raw.replace(/^GNDEC\s*/i, '').trim();
}

function parseTimetableTable($, table, groupName) {
  const days = [];
  $(table).find('thead th.xAxis').each((i, el) => days.push($(el).text().trim()));

  // Collect tbody rows excluding foot rows
  const tbodyRows = $(table).find('tbody tr').not('.foot').toArray();
  const rowCount = tbodyRows.length;

  // Read yAxis labels (1,2,3...) if present so we can map them to TIME_SLOTS
  const rowNumbers = tbodyRows.map(rowEl => {
    const txt = $(rowEl).find('th.yAxis').first().text().trim();
    const n = parseInt(txt.replace(/^0+/, '') || '', 10);
    return Number.isNaN(n) ? null : n;
  });
  const colCount = days.length;

  // Initialize an empty grid for rowCount x colCount
  const grid = Array.from({ length: rowCount }, () => Array(colCount).fill(null));

  // Helper to find next empty column index in a given row starting from idx
  function nextEmptyCol(rowIdx, start = 0) {
    for (let c = start; c < colCount; c++) if (!grid[rowIdx][c]) return c;
    return -1;
  }

  // Fill grid respecting rowspan and colspan
  tbodyRows.forEach((rowEl, rIdx) => {
    const $row = $(rowEl);
    let colPointer = 0;
    // skip th.yAxis cells
    $row.children('td, th').each((_, cell) => {
      const $cell = $(cell);
      if ($cell.is('th')) return; // skip header cells
      // find next empty column to place this cell
      colPointer = nextEmptyCol(rIdx, colPointer);
      if (colPointer === -1) return;
      const rowspan = parseInt($cell.attr('rowspan') || '1', 10);
      const colspan = parseInt($cell.attr('colspan') || '1', 10);
      const data = parseCell($, $cell);
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) {
          const rr = rIdx + dr;
          const cc = colPointer + dc;
          if (rr < rowCount && cc < colCount) {
            grid[rr][cc] = { data, originRow: rIdx };
          }
        }
      }
      colPointer = colPointer + colspan;
    });
  });

  // Build classes array from grid; determine times using yAxis numbers when present
  const classes = [];
  for (let r = 0; r < rowCount; r++) {
    // Prefer a yAxis label (like 1,2,3...) for the row to map to TIME_SLOTS.
    // If not present, fall back to the row index.
    const rowNumber = rowNumbers[r];
    const defaultTime = (typeof rowNumber === 'number' && rowNumber >= 1 && rowNumber <= TIME_SLOTS.length)
      ? TIME_SLOTS[rowNumber - 1]
      : (TIME_SLOTS[r] || null);

    for (let c = 0; c < colCount; c++) {
      const cell = grid[r][c];
      if (!cell) {
        classes.push({ dayOfClass: capitalize(days[c] || ''), timeOfClass: defaultTime, data: { subject: null, teacher: null, classRoom: null, elective: false, freeClass: true, Lab: false, Tut: false, OtherDepartment: false } });
      } else {
        // If this cell originates from an earlier row (rowspan), try to use that origin's yAxis number
        const originRow = (cell.originRow != null) ? cell.originRow : r;
        const originNumber = rowNumbers[originRow];
        let mappedTime = null;
        if (typeof originNumber === 'number' && originNumber >= 1 && originNumber <= TIME_SLOTS.length) {
          mappedTime = TIME_SLOTS[originNumber - 1];
        } else {
          mappedTime = TIME_SLOTS[originRow] || defaultTime || null;
        }
        classes.push({ dayOfClass: capitalize(days[c] || ''), timeOfClass: mappedTime, data: cell.data });
      }
    }
  }
  return classes;
}

function parseCell($, cell) {
  const $cell = $(cell);
  const html = $cell.html() || '';

  // Free slot marker
  const plainText = $cell.text().trim();
  if (/^-x-$|^---$|^\s*$/i.test(plainText) || plainText === '---') {
    return { subject: null, teacher: null, classRoom: null, elective: false, freeClass: true, Lab: false, Tut: false, OtherDepartment: false };
  }

  // Detailed inner table (multiple entries)
  const innerTable = $cell.find('table.detailed, table');
  if (innerTable.length) {
    const rows = [];
    innerTable.find('tbody tr').each((ri, r) => {
      const cols = [];
      $(r).find('td, th').each((ci, c) => cols.push($(c).text().trim()));
      // if this row is empty (some tables have stray empty rows), skip
      const hasNonEmpty = cols.some(v => v && v.length);
      if (hasNonEmpty) rows.push(cols);
    });
    const entries = [];
    const colCount = rows[0] ? rows[0].length : 0;
    if (colCount > 0 && rows.length > 0) {
      // Heuristic mapping:
      // If there are 4+ rows, treat as: [groupLabels, subjectRow, teacherRow, roomRow, ...]
      // If 3 rows, treat as: [subjectRow, teacherRow, roomRow]
      // If different, attempt to map last 3 rows to subject/teacher/room and first row to group labels when present.
      let groupRow = null;
      let subjectRow = null;
      let teacherRow = null;
      let roomRow = null;

      if (rows.length >= 4) {
        groupRow = rows[0];
        subjectRow = rows[1] || [];
        teacherRow = rows[2] || [];
        roomRow = rows[3] || [];
      } else if (rows.length === 3) {
        subjectRow = rows[0];
        teacherRow = rows[1];
        roomRow = rows[2];
      } else if (rows.length === 2) {
        subjectRow = rows[0];
        teacherRow = rows[1];
      } else {
        // fallback: map last 3 rows
        const last = rows.slice(-3);
        subjectRow = last[0] || [];
        teacherRow = last[1] || [];
        roomRow = last[2] || [];
        if (rows.length > 3) groupRow = rows[0];
      }

      for (let ci = 0; ci < colCount; ci++) {
        const groupLabel = (groupRow && groupRow[ci]) || null;
        const subject = (subjectRow && subjectRow[ci]) || null;
        const teacher = (teacherRow && teacherRow[ci]) || null;
        const classRoom = (roomRow && roomRow[ci]) || null;
        // If subject is empty but groupLabel contains comma-separated groups with subject-like text,
        // try to shift rows (some tables omit a clear header)
        if (!subject && groupLabel && /\b[A-Z]{1,4}\b|D\d\s*ME/i.test(groupLabel) && (teacher || classRoom)) {
          // treat groupLabel as group and leave subject null
        }
        if (subject || teacher || classRoom || groupLabel) entries.push({ group: groupLabel, subject, teacher, classRoom });
      }
    }
    return { elective: true, freeClass: false, entries };
  }

  // Div-based structure (line1 / line2 / line3) with activity tag
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
    return { subject, teacher, classRoom, elective: false, freeClass: !subject, Lab: /\bP\b|LAB/i.test(subject || ''), Tut: /\bT\b/i.test(subject || ''), OtherDepartment: false };
  }

  // Fallback: split by <br>
  const lines = html
    .split(/<br\s*\/?/i)
    .map(l => l.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  return { subject: lines[0] || null, teacher: lines[1] || null, classRoom: lines[2] || null, elective: false, freeClass: !lines[0], Lab: /\bP\b|LAB/i.test(lines[0] || ''), Tut: /\bT\b/i.test(lines[0] || ''), OtherDepartment: false };
}

async function main() {
  try {
    const html = await fetchHTML(URL);
    const $ = cheerio.load(html);
    const timetable = {};

    // Discover initial table ids (from various tab patterns)
    const initialTableIds = discoverGroupTableIds($);
    if (!initialTableIds.length) {
      // fallback to older pattern
      $("table[id^='table_']").each((_, t) => {
        const id = $(t).attr('id');
        if (id) initialTableIds.push('#' + id);
      });
    }

    // Try to read an existing group list, otherwise we'll build one
    let groupList = [];
    try {
      if (fs.existsSync(GROUP_LIST_PATH)) {
        groupList = JSON.parse(fs.readFileSync(GROUP_LIST_PATH, 'utf-8')) || [];
      }
    } catch (err) {
      console.warn('Could not read existing group list, will build from page:', err.message);
    }

    // Process tables in a queue so that linked/nested tab targets discovered while
    // parsing a table are also processed ("search again with that group tab content id").
    const queue = Array.from(initialTableIds);
    const processed = new Set();

    while (queue.length) {
      const tableSelector = queue.shift();
      if (!tableSelector || processed.has(tableSelector)) continue;
      processed.add(tableSelector);
      const table = $(tableSelector);
      if (!table.length) continue;

      // Resolve a human-readable group name for this table
      const resolved = resolveGroupName($, tableSelector);

      // Attempt to match to existing group list entries (case-insensitive / partial / nospace)
      let matched = null;
      if (groupList && groupList.length) {
        matched = groupList.find(g => g.toLowerCase() === resolved.toLowerCase());
        if (!matched) matched = groupList.find(g => resolved.toLowerCase().includes(g.toLowerCase()));
        if (!matched) matched = groupList.find(g => g.replace(/\s+/g, '').toLowerCase() === resolved.replace(/\s+/g, '').toLowerCase());
      }

      const groupKey = matched || resolved;

      // Ensure unique keys: if clash, append short id
      let finalKey = groupKey;
      if (timetable[finalKey]) {
        finalKey = `${groupKey} (${tableSelector.replace(/^#/, '')})`;
      }

      timetable[finalKey] = { classes: parseTimetableTable($, table, finalKey) };

      // Find any anchors/buttons inside or near this table that reference other table ids
      table.find('[data-target], [data-bs-target], a[href^="#"], button[data-target], [aria-controls]').each((i, el) => {
        const $el = $(el);
        const tgt = ($el.attr('data-target') || $el.attr('data-bs-target') || $el.attr('href') || $el.attr('aria-controls') || '').trim();
        const canonical = tgt.startsWith('#') ? tgt : (tgt ? ('#' + tgt) : '');
        if (canonical && /^#/.test(canonical) && /table|time|timetable/i.test(canonical)) {
          if (!processed.has(canonical) && !queue.includes(canonical)) queue.push(canonical);
        }
      });
    }

    // Ensure all known groups from groupList exist in timetable (empty classes if missing)
    for (const g of (groupList || []).concat()) {
      if (!timetable[g]) timetable[g] = { classes: [] };
    }

    // Build final group list from timetable keys and write to disk
    try {
      const discovered = Object.keys(timetable);
      fs.mkdirSync(path.dirname(GROUP_LIST_PATH), { recursive: true });
      fs.writeFileSync(GROUP_LIST_PATH, JSON.stringify(discovered, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write mechanical group info:', err.message);
    }

    const output = {
      url: URL,
      timetable
    };
    fs.writeFileSync(
      OUTPUT_PATH,
      JSON.stringify(output, null, 2),
      'utf-8'
    );
    console.log('Mechanical timetable scraped and saved to', OUTPUT_PATH);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

if (require.main === module) {
  main();
}
