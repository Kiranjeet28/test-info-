const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const TIMETABLE_URLS = require('../timetableUrls');
const ELECTRICAL_URL = TIMETABLE_URLS.electrical;
function normalizeTimeString(raw) {
    if (!raw) return raw;
    // strip AM/PM and extra whitespace
    let t = String(raw).replace(/\s*(AM|PM|am|pm)\b/, '').trim();
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return t;
    let h = parseInt(m[1], 10);
    const mm = m[2];
    // if time is 1..6, treat it as afternoon (13..18)
    if (h >= 1 && h <= 6) h = h + 12;
    const hh = String(h).padStart(2, '0');
    return `${hh}:${mm}`;
}
function parseCell($, cell) {
    const $cell = $(cell);
    const html = $cell.html() || '';

    // Plain-text free slot markers
    const plainText = $cell.text().trim();
    if (/^(?:-x-|---|\s*)$/i.test(plainText)) {
        return { subject: null, teacher: null, classRoom: null, elective: false, freeClass: true };
    }

    // Detailed inner table (multiple subgroup entries)
    const innerTable = $cell.find('table.detailed, table');
    if (innerTable.length) {
        const rows = [];
        innerTable.find('tbody tr').each((ri, r) => {
            const cols = [];
            $(r).find('td, th').each((ci, c) => cols.push($(c).text().trim()));
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
        // If this detailed table describes only one subgroup/entry, flatten it
        if (entries.length === 1) {
            const e = entries[0];
            const subj = e.subject || null;
            const teach = e.teacher || null;
            const room = e.classRoom || null;
            return {
                subject: subj,
                teacher: teach,
                classRoom: room,
                elective: false,
                freeClass: false,
                Lab: /\bP\b|LAB/i.test(subj || ''),
                Tut: /\bT\b/i.test(subj || ''),
                OtherDepartment: false
            };
        }
        return { elective: entries.length > 1, freeClass: false, entries };
    }

    // Div-based structure: .line1 (subject + activitytag), .line2 (teacher), .line3 (room)
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

    // Fallback: split by <br> (allow variations)
    const parts = html
        .split(/<br\s*\/?/i)
        .map(v => cheerio.load(v).text().trim())
        .filter(Boolean);
    if (parts.length === 0) return { subject: null, teacher: null, classRoom: null, elective: false, freeClass: true };
    if (parts.length === 3) return { subject: parts[0], teacher: parts[1], classRoom: parts[2], elective: false, freeClass: false };
    // If multiple parts, group into entries
    const entries = [];
    for (let i = 0; i < parts.length; i += 3) {
        if (parts[i + 2]) entries.push({ subject: parts[i], teacher: parts[i + 1] || null, classRoom: parts[i + 2] });
    }
    if (entries.length === 1) {
        const e = entries[0];
        return { subject: e.subject || null, teacher: e.teacher || null, classRoom: e.classRoom || null, elective: false, freeClass: false, Lab: /\bP\b|LAB/i.test(e.subject || ''), Tut: /\bT\b/i.test(e.subject || ''), OtherDepartment: false };
    }
    return { elective: entries.length > 1, freeClass: false, entries: entries.length > 1 ? entries : null };
}


async function scrapeElectricalTimetable(url = ELECTRICAL_URL) {
    const {
        data: html
    } = await axios.get(url);
    const $ = cheerio.load(html);
    const result = {};

    const groups = [];
    $('ul > li > a').each((_, a) => {
        const groupName = $(a).text().trim();
        const tableId = $(a).attr('href').substring(1);
        groups.push({
            name: groupName,
            tableId: tableId
        });
    });

    for (const group of groups) {
        const table = $(`#${group.tableId}`);
        if (table.length === 0) continue;

        const classes = [];
        const xAxis = [];
        table.find('thead tr:first-child th.xAxis').each((_, th) => {
            xAxis.push($(th).text().trim());
        });

        table.find('tbody tr').each((rowIndex, row) => {
            if ($(row).hasClass('foot')) {
                return;
            }
            const yAxisCell = $(row).find('th.yAxis');
            if (!yAxisCell.length) return;

                const rawTime = yAxisCell.first().text().trim();
                if (!rawTime) return;
                // normalize times like "1:30" -> "13:30"
               const timeOfClass = normalizeTimeString(rawTime);

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

        result[group.name] = {
            classes
        };
    }

    return result;
}

async function scrapeElectricalAndSave(url = ELECTRICAL_URL) {
    const timetable = await scrapeElectricalTimetable(url);
    const groupPath = path.join(__dirname, '../../../web/group/electrical.json');
    const timetablePath = path.join(__dirname, '../../../public/timetable_electrical.json');
    try {
        if (!timetable || typeof timetable !== 'object') {
            console.error('Timetable is invalid:', timetable);
            return { url, timetable };
        }
        const groupNames = Object.keys(timetable);
        fs.mkdirSync(path.dirname(groupPath), { recursive: true });
        fs.writeFileSync(groupPath, JSON.stringify(groupNames, null, 2));
        // Save timetable in the correct format for frontend
        fs.mkdirSync(path.dirname(timetablePath), { recursive: true });
        fs.writeFileSync(timetablePath, JSON.stringify({ url, timetable }, null, 2));
        // Also save a copy to web/timetable_electrical.json
        const webTimetablePath = path.join(__dirname, '../../../web/timetable_electrical.json');
        fs.mkdirSync(path.dirname(webTimetablePath), { recursive: true });
        fs.writeFileSync(webTimetablePath, JSON.stringify({ url, timetable }, null, 2));
    } catch (err) {
        console.error('Failed to write Electrical group or timetable info:', err.message);
    }
    return { url, timetable };
}

module.exports = {
    scrapeElectricalTimetable,
    scrapeElectricalAndSave
};

if (require.main === module) {
    scrapeElectricalAndSave()
        .then(({ url, timetable }) => {
            console.log('Scraping complete. Timetable saved for Electrical groups.');
        })
        .catch(err => {
            console.error('Error scraping Electrical timetable:', err);
        });
}