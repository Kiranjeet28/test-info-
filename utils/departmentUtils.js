const fs = require('fs');
const path = require('path');

const GROUPS_DIR = path.join(__dirname, '..', 'web', 'group');

const DEPARTMENT_OPTIONS = [
  { key: 'appliedscience', label: 'Applied Science' },
  { key: 'bca', label: 'BCA' },
  { key: 'civil', label: 'Civil Engineering' },
  { key: 'cse', label: 'Computer Science & Engineering' },
  { key: 'ece', label: 'Electronics & Communication Engineering' },
  { key: 'electrical', label: 'Electrical Engineering' },
  { key: 'it', label: 'Information Technology' },
  { key: 'mechanical', label: 'Mechanical Engineering' }
];

function fetchDepartments() {
  return DEPARTMENT_OPTIONS;
}

function fetchGroups(departmentKey) {
  const filePath = path.join(GROUPS_DIR, `${departmentKey}.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

module.exports = {
  DEPARTMENT_OPTIONS,
  fetchDepartments,
  fetchGroups
};