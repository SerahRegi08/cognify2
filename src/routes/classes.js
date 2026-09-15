const express = require('express');
const { read, write } = require('../store');

const router = express.Router();

// Whole-list sync. Frontend owns ids; backend is the durable copy.
// LocalStorage stays as offline fallback, so empty/missing backend never wipes data.
router.get('/', (req, res) => res.json(read('classes.json', [])));

router.put('/', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected an array' });
  write('classes.json', req.body);
  return res.json({ ok: true });
});

module.exports = router;
