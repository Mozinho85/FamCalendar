const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const router = express.Router();

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

// GET /api/members
router.get('/', (req, res) => {
  const members = db.prepare('SELECT id, name, color, google_calendar_ids, ical_urls FROM family_members ORDER BY rowid').all();
  res.json(members.map(m => ({
    ...m,
    google_calendar_ids: JSON.parse(m.google_calendar_ids || '[]'),
    ical_urls: JSON.parse(m.ical_urls || '[]'),
    google_connected: Boolean(
      db.prepare('SELECT google_refresh_token FROM family_members WHERE id = ?').get(m.id)?.google_refresh_token
    ),
  })));
});

// POST /api/members
router.post('/',
  body('name').trim().notEmpty(),
  body('color').matches(/^#[0-9a-fA-F]{6}$/),
  validate,
  (req, res) => {
    const id = uuidv4();
    db.prepare('INSERT INTO family_members (id, name, color) VALUES (?, ?, ?)')
      .run(id, req.body.name, req.body.color);
    res.status(201).json(db.prepare('SELECT id, name, color FROM family_members WHERE id = ?').get(id));
  }
);

// PUT /api/members/:id
router.put('/:id',
  body('name').optional().trim().notEmpty(),
  body('color').optional().matches(/^#[0-9a-fA-F]{6}$/),
  body('google_calendar_ids').optional().isArray(),
  validate,
  (req, res) => {
    const member = db.prepare('SELECT * FROM family_members WHERE id = ?').get(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const updates = [];
    const values = [];

    if (req.body.name)  { updates.push('name = ?');  values.push(req.body.name); }
    if (req.body.color) { updates.push('color = ?'); values.push(req.body.color); }
    if (req.body.google_calendar_ids) {
      updates.push('google_calendar_ids = ?');
      values.push(JSON.stringify(req.body.google_calendar_ids));
    }
    if (req.body.ical_urls !== undefined) {
      updates.push('ical_urls = ?');
      values.push(JSON.stringify(req.body.ical_urls));
    }

    if (updates.length) {
      updates.push("updated_at = datetime('now')");
      values.push(req.params.id);
      db.prepare(`UPDATE family_members SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    res.json(db.prepare('SELECT id, name, color, google_calendar_ids FROM family_members WHERE id = ?').get(req.params.id));
  }
);

// DELETE /api/members/:id
router.delete('/:id', (req, res) => {
  const member = db.prepare('SELECT * FROM family_members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  db.prepare('DELETE FROM family_members WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
