const express = require('express');
const { read, write } = require('../store');

const router = express.Router();

router.get('/', (req, res) => res.json(read('assignments.json', [])));

router.put('/', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected an array' });
  write('assignments.json', req.body);
  return res.json({ ok: true });
});

module.exports = router;
