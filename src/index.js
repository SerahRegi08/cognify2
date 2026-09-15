require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { analyzePaper } = require('./analyze');
const { getHistory, addRecord } = require('./history');
const { generateWorksheet } = require('./worksheet');
const { generateDailyPlan } = require('./dailyplan');
const { generateInsights } = require('./insights');
const { read, write } = require('./store');
const classRoutes = require('./routes/classes');
const assignmentRoutes = require('./routes/assignments');
const worksheetRoutes = require('./routes/worksheets');
const submissionRoutes = require('./routes/submissions');

const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const nameMatch = (a, b) => {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x));
};

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: (process.env.FRONTEND_URL || 'http://localhost:3000').split(',') }));
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Only images or PDFs are allowed'), ok);
  },
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Class names only (no student data) — lets new students pick their class.
app.get('/api/classes/names', (req, res) => {
  const classes = read('classes.json', []);
  return res.json(classes.map((c) => ({ id: c.id, name: c.name })));
});

// GET /api/students/classes?name=X&school=Y — classes containing a same-named
// student of the same school (id + name only). Lenient name matching is safe
// here: worst case is seeing an extra class's assignments, never another
// student's assessment.
app.get('/api/students/classes', (req, res) => {
  const q = String(req.query.name || '');
  if (!normName(q)) return res.status(400).json({ error: 'name is required' });
  const school = normName(req.query.school || '');
  const sameSchool = (recordSchool) => {
    const r = normName(recordSchool);
    return !r || !school || r === school;
  };
  const out = [];
  read('classes.json', []).forEach((c) => {
    if (school && normName(c.school) && normName(c.school) !== school) return;
    if ((c.studentsList || []).some((s) => nameMatch(s.name, q) && sameSchool(s.school))) {
      out.push({ id: c.id, name: c.name });
    }
  });
  return res.json(out);
});

// GET /api/students/lookup?name=X&school=Y — scan records + worksheets for
// one student, same school only (records without a school still match,
// so legacy data keeps working). Powers the student dashboard.
app.get('/api/students/lookup', (req, res) => {
  const q = String(req.query.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return res.status(400).json({ error: 'name is required' });
  const school = normName(req.query.school || '');
  const samePerson = (name) => {
    const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    // Exact match only: never show one student's assessment to another.
    // No scans under your exact name = no assessment shown.
    return Boolean(n) && n === q;
  };
  const sameSchool = (recordSchool) => {
    const r = normName(recordSchool);
    return !r || !school || r === school;
  };
  const matches = [];
  read('classes.json', []).forEach((c) => {
    (c.studentsList || []).forEach((s) => {
      if (samePerson(s.name) && sameSchool(s.school)) {
        matches.push({
          classId: c.id,
          className: c.name,
          history: getHistory(c.id, s.name),
          ...s,
        });
      }
    });
  });
  const worksheets = read('worksheets.json', []).filter((w) => samePerson(w.studentName));
  return res.json({ query: req.query.name, matches, worksheets });
});
app.use('/api/classes', classRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/worksheets', worksheetRoutes);
app.use('/api/submissions', submissionRoutes);

// POST /api/classes/:id/analyze (fields: paper=file, studentName=text)
// Returns { student } — frontend adds it to the class student list,
// which updates the Performance / Support / AI insights columns.
app.post('/api/classes/:id/analyze', upload.single('paper'), async (req, res) => {
  try {
    const studentName = String(req.body.studentName || '').trim();
    const subject = String(req.body.subject || '').trim();
    const school = String(req.body.school || '').trim();
    const board = String(req.body.board || '').trim();
    if (!studentName) return res.status(400).json({ error: 'Student name is required' });
    if (!req.file) return res.status(400).json({ error: 'Paper file is required' });

    const history = getHistory(req.params.id, studentName, subject);

    const student = await analyzePaper({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      studentName,
      classId: req.params.id,
      history,
      subject,
    });

    if (school) student.school = school;
    if (board) student.board = board;

    // remember this paper under this exact student + class (+ subject)
    addRecord(req.params.id, studentName, {
      performanceLevel: student.performanceLevel,
      insights: student.insights,
      weakTopics: student.weakTopics || [],
      supportNeeds: student.supportNeeds || [],
      evidence: student.evidence || [],
      unverified: Boolean(student.unverified),
    }, subject);

    // write-through: file the result straight into the teacher's class,
    // matched by class + student name (and stamp the school), so the
    // teacher side picks it up.
    upsertStudentInClass(req.params.id, student, school, board);

    return res.json({ student });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not analyse paper' });
  }
});

// Insert or replace one student row inside a class (matched by name).
// Stamps the school/board when the class or row doesn't have one yet.
function upsertStudentInClass(classId, student, school = '', board = '') {
  try {
    const classes = read('classes.json', []);
    const idx = classes.findIndex((c) => c.id === classId);
    if (idx < 0) return false;
    if (school && !classes[idx].school) classes[idx].school = school;
    if (board && !classes[idx].board) classes[idx].board = board;
    const norm = String(student.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const list = classes[idx].studentsList || [];
    const at = list.findIndex((s) => String(s.name || '').trim().toLowerCase().replace(/\s+/g, ' ') === norm);
    const row = { ...student };
    if (school && !row.school) row.school = school;
    if (board && !row.board) row.board = board;
    if (at >= 0) list[at] = row;
    else list.push(row);
    classes[idx].studentsList = list;
    write('classes.json', classes);
    return true;
  } catch (err) {
    console.error('write-through failed:', err.message);
    return false;
  }
}

// POST /api/worksheet { studentName, performanceLevel, weakTopics[], weakAreas[] }
// Returns { worksheet } targeted at the student's weak areas.
app.post('/api/worksheet', async (req, res) => {
  try {
    const { studentName = '', performanceLevel = 'average', weakTopics = [], weakAreas = [] } = req.body || {};
    if (!String(studentName).trim()) return res.status(400).json({ error: 'Student name is required' });
    const worksheet = await generateWorksheet({
      studentName: String(studentName).trim(),
      performanceLevel,
      weakTopics: Array.isArray(weakTopics) ? weakTopics : [],
      weakAreas: Array.isArray(weakAreas) ? weakAreas : [],
    });
    return res.json({ worksheet });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not generate worksheet' });
  }
});
// POST /api/daily-plan { studentName, level, assignments[], worksheets[], todos[], weakTopics[] }
// Returns { tasks: [{text, reason}], focus, aiGenerated } — one day's plan.
app.post('/api/daily-plan', async (req, res) => {
  try {
    const plan = await generateDailyPlan(req.body || {});
    return res.json(plan);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not generate daily plan' });
  }
});
// GET /api/insights — teacher briefing: improvement, focus students,
// per-class notes. Computed from real scan data.
app.get('/api/insights', async (req, res) => {
  try {
    return res.json(await generateInsights());
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not generate insights' });
  }
});
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
  next();
});

app.listen(PORT, () => {
  console.log(`Cognify backend running on http://localhost:${PORT}`);
});
