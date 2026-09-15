// Per-student memory: every scanned paper is recorded under
// "<classId>|||<normalized student name>" so each of the 150+ students
// keeps a separate history that survives backend restarts.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'students.json');
const KEEP_LAST = 20;

function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function keyFor(classId, name, subject = '') {
  return `${classId}|||${normalizeName(name)}|||${normalizeName(subject)}`;
}

function legacyKeyFor(classId, name) {
  return `${classId}|||${normalizeName(name)}`;
}

function loadAll() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveAll(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getHistory(classId, name, subject = '') {
  const all = loadAll();
  const list = all[keyFor(classId, name, subject)];
  if (Array.isArray(list) && list.length > 0) return list;
  // Backwards compatibility: scans recorded before subject support.
  if (!normalizeName(subject)) {
    const legacy = all[legacyKeyFor(classId, name)];
    if (Array.isArray(legacy)) return legacy;
  }
  return [];
}

function addRecord(classId, name, entry, subject = '') {
  const all = loadAll();
  const key = keyFor(classId, name, subject);
  const list = all[key] || [];
  list.push({ date: new Date().toISOString(), ...entry });
  all[key] = list.slice(-KEEP_LAST);
  saveAll(all);
  return all[key];
}

module.exports = { getHistory, addRecord, normalizeName };
