const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { read, write } = require('../store');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Only images or PDFs are allowed'), ok);
  },
});

// Worksheet metadata list (AI entries + upload entries).
router.get('/', (req, res) => res.json(read('worksheets.json', [])));

router.put('/', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected an array' });
  write('worksheets.json', req.body);
  return res.json({ ok: true });
});

// Teacher upload: file lands on backend disk, only metadata goes anywhere else.
router.post('/upload', upload.single('file'), (req, res) => {
  try {
    const { title = '', className = '' } = req.body || {};
    if (!req.file) return res.status(400).json({ error: 'File is required' });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const id = `${Date.now()}`;
    const safeName = `${id}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, safeName), req.file.buffer);
    const entry = {
      id,
      title: String(title).trim() || req.file.originalname,
      studentName: '',
      className: String(className),
      source: 'upload',
      fileName: req.file.originalname,
      fileId: safeName,
      createdAt: Date.now(),
    };
    const list = read('worksheets.json', []);
    list.unshift(entry);
    write('worksheets.json', list);
    return res.status(201).json(entry);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not store worksheet' });
  }
});

// Serve a stored upload.
router.get('/file/:fileId', (req, res) => {
  const safe = path.basename(String(req.params.fileId || ''));
  const file = path.join(UPLOAD_DIR, safe);
  if (!safe || !fs.existsSync(file)) return res.status(404).json({ error: 'File not found' });
  return res.sendFile(file);
});

// Delete metadata (+ disk file for uploads).
router.delete('/:id', (req, res) => {
  const list = read('worksheets.json', []);
  const entry = list.find((item) => item.id === req.params.id);
  write(
    'worksheets.json',
    list.filter((item) => item.id !== req.params.id)
  );
  if (entry && entry.fileId) {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(entry.fileId)));
    } catch {
      // file already gone — metadata removal is what matters
    }
  }
  return res.json({ ok: true });
});

module.exports = router;
