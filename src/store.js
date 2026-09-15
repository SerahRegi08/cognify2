// Tiny JSON-file store for lists that outgrow browser storage.
// Files live in backend/data/ (gitignored) — no database server needed.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function read(name, fallback) {
  try {
    const file = path.join(DATA_DIR, name);
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function write(name, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2));
}

module.exports = { read, write };
