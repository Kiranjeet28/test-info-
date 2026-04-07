const fs = require('fs');
const path = require('path');
const axios = require('axios');

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

async function fetchGroups(departmentKey) {
  const githubUrl = `https://raw.githubusercontent.com/Kiranjeet28/infocascade-data/main/web/group/${departmentKey}.json`;
  try {
    const response = await axios.get(githubUrl);
    const parsed = response.data;
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Error fetching groups for ${departmentKey}: ${error.message}`);
    return [];
  }
}

module.exports = {
  DEPARTMENT_OPTIONS,
  fetchDepartments,
  fetchGroups
};