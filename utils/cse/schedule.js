import { parse } from 'date-fns';

function timeToMinutes(t) {
  if (!t) return null;
  // expect HH:MM (24h) or H:MM
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Normalize messy timetable JSON into events: { group, dayName, startMin, endMin, text }
export function normalizeTableToEvents(timetable) {
  const events = [];
  (timetable.tables || []).forEach(table => {
    const group = (table.headers && table.headers[0]) || 'UNKNOWN';
    const rows = table.rows || [];
    if (!rows.length) return;

    // find days mapping row (contains weekday names)
    let daysRowIndex = -1;
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const r = rows[i];
      const vals = Object.values(r).map(String).map(s => s.toLowerCase());
      if (vals.some(v => v.includes('monday') || v.includes('tuesday') || v.includes('wednesday') || v.includes('thursday') || v.includes('friday') || v.includes('saturday') || v.includes('sunday'))) { daysRowIndex = i; break; }
    }
    if (daysRowIndex === -1) return;

    const daysRow = rows[daysRowIndex];
    const colKeys = Object.keys(daysRow);
    const dayNames = colKeys.map(k => daysRow[k]);

    // iterate subsequent rows and group by time slots
    const contentRows = rows.slice(daysRowIndex + 1);
    // find indices where a cell looks like a time (HH:MM)
    const timeRowIndices = [];
    for (let i = 0; i < contentRows.length; i++) {
      const r = contentRows[i];
      const vals = Object.values(r);
      if (vals.some(v => typeof v === 'string' && /\d{1,2}:\d{2}/.test(v))) timeRowIndices.push(i);
    }

    for (let t = 0; t < timeRowIndices.length; t++) {
      const idx = timeRowIndices[t];
      const nextIdx = (t + 1 < timeRowIndices.length) ? timeRowIndices[t + 1] : contentRows.length;
      const timeRow = contentRows[idx];
      // for each day column produce text by concatenating cells from idx .. nextIdx-1
      for (let c = 0; c < colKeys.length; c++) {
        const key = colKeys[c];
        const day = (dayNames[c] || '').trim();
        const startText = (timeRow[key] || '').trim();
        const startMin = timeToMinutes(startText);
        if (startMin == null) continue;

        // collect text lines for this column
        const parts = [];
        for (let r = idx; r < nextIdx; r++) {
          const rowObj = contentRows[r];
          const v = rowObj[key];
          if (v && String(v).trim()) parts.push(String(v).trim());
        }
        const text = parts.join(' | ');

        // compute endMin using next time row's time in same column if present
        let endMin = null;
        if (t + 1 < timeRowIndices.length) {
          const nextRow = contentRows[timeRowIndices[t + 1]];
          const nextText = String(nextRow[key] || '').trim();
          endMin = timeToMinutes(nextText) || (startMin + 60);
        } else {
          endMin = startMin + 60;
        }

        events.push({ group, dayName: day, startMin, endMin, text });
      }
    }
  });
  return events;
}

export function getCurrentAndNextClass(events, group, now = new Date()) {
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const minutes = now.getHours() * 60 + now.getMinutes();
  const todays = events.filter(e => (e.group === group) && (String(e.dayName).toLowerCase().includes(weekday.toLowerCase()))).sort((a,b)=>a.startMin-b.startMin);
  let current = null, next = null;
  for (let i = 0; i < todays.length; i++) {
    const e = todays[i];
    if (e.startMin <= minutes && minutes < e.endMin) { current = e; next = todays[i+1] || null; break; }
    if (e.startMin > minutes) { next = e; break; }
  }
  return { current, next };
}

// Convert our stored web/timetable.json format into the events shape used above.
export function convertWebTimetableToEvents(webTimetable) {
  const events = [];
  if (!webTimetable || !webTimetable.timetable) return events;
  const table = webTimetable.timetable;
  Object.entries(table).forEach(([group, groupObj]) => {
    const classes = (groupObj && groupObj.classes) || [];
    classes.forEach(cls => {
      const day = cls.dayOfClass || '';
      const time = cls.timeOfClass || (cls.data && cls.data.time) || '';
      const startMin = timeToMinutes(time);
      if (startMin == null) return;
      const data = cls.data || {};

      let text = '';
      if (data.freeClass) {
        text = 'Free';
      } else if (data.elective && Array.isArray(data.entries)) {
        text = data.entries.map(e => `${e.subject || ''}${e.teacher ? ' - ' + e.teacher : ''}${e.classRoom ? ' @ ' + e.classRoom : ''}`).join(' | ');
      } else {
        text = `${data.subject || ''}${data.teacher ? ' - ' + data.teacher : ''}${data.classRoom ? ' @ ' + data.classRoom : ''}`.trim();
      }

      const endMin = startMin + 60;
      events.push({ group, dayName: day, startMin, endMin, text });
    });
  });
  return events;
}

// Return the raw timetable object for a matching group name (case/space-insensitive).
export function getTimetableForGroup(webTimetable, groupName) {
  if (!webTimetable || !webTimetable.timetable || !groupName) return null;
  const keys = Object.keys(webTimetable.timetable);
  const target = keys.find(k => k.toLowerCase() === groupName.toLowerCase() || k.replace(/\s+/g, '').toLowerCase() === groupName.replace(/\s+/g, '').toLowerCase());
  if (!target) return null;
  return webTimetable.timetable[target];
}
