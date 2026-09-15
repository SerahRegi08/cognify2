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

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// POST /api/submissions (fields: file, assignmentId, studentName)
// One submission per student per assignment: resubmitting replaces the old file.
router.post('/', upload.single('file'), (req, res) => {
  try {
    const { assignmentId = '', studentName = '' } = req.body || {};
    if (!assignmentId) return res.status(400).json({ error: 'assignmentId is required' });
    if (!norm(studentName)) return res.status(400).json({ error: 'Student name is required' });
    if (!req.file) return res.status(400).json({ error: 'File is required' });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const id = `${Date.now()}`;
    const safeName = `${id}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, safeName), req.file.buffer);
    const record = {
      id,
      assignmentId,
      studentName: String(studentName).trim(),
      fileName: req.file.originalname,
      fileId: safeName,
      submittedAt: Date.now(),
    };
    const list = read('submissions.json', []);
    const next = [
      ...list.filter(
        (r) => !(r.assignmentId === assignmentId && norm(r.studentName) === norm(studentName))
      ),
      record,
    ];
    write('submissions.json', next);
    return res.status(201).json(record);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not save submission' });
  }
});

// GET /api/submissions?assignmentId=&student=
router.get('/', (req, res) => {
  const list = read('submissions.json', []);
  const { assignmentId, student } = req.query;
  let out = list;
  if (assignmentId) out = out.filter((r) => r.assignmentId === assignmentId);
  if (student) out = out.filter((r) => norm(r.studentName) === norm(student));
  return res.json(out);
});

// GET /api/submissions/file/:fileId
router.get('/file/:fileId', (req, res) => {
  const safe = path.basename(String(req.params.fileId || ''));
  const file = path.join(UPLOAD_DIR, safe);
  if (!safe || !fs.existsSync(file)) return res.status(404).json({ error: 'File not found' });
  return res.sendFile(file);
});

module.exports = router;
