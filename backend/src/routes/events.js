const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const router = express.Router();

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
}

// GET /api/events
// Query params: start, end (ISO strings), member_id
router.get('/',
  query('start').optional().isISO8601(),
  query('end').optional().isISO8601(),
  validate,
  (req, res) => {
    let sql = 'SELECT * FROM events WHERE 1=1';
    const params = [];

    if (req.query.start) {
      sql += ' AND end_datetime >= ?';
      params.push(req.query.start);
    }
    if (req.query.end) {
      sql += ' AND start_datetime <= ?';
      params.push(req.query.end);
    }
    if (req.query.member_id && req.query.member_id !== 'all') {
      sql += ' AND member_id = ?';
      params.push(req.query.member_id);
    }

    sql += ' ORDER BY start_datetime ASC';

    const events = db.prepare(sql).all(...params);
    res.json(events);
  }
);

// POST /api/events - create a local event
router.post('/',
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('start_datetime').isISO8601().withMessage('Valid start datetime required'),
  body('end_datetime').isISO8601().withMessage('Valid end datetime required'),
  body('member_id').optional().isString(),
  body('all_day').optional().isBoolean(),
  body('color').optional().isString(),
  body('location').optional().isString(),
  body('notes').optional().isString(),
  body('important').optional().isBoolean(),
  validate,
  (req, res) => {
    const id = uuidv4();
    const { title, start_datetime, end_datetime, member_id, all_day, color, location, notes, important } = req.body;

    // Inherit color from member if not specified
    let eventColor = color;
    if (!eventColor && member_id) {
      const member = db.prepare('SELECT color FROM family_members WHERE id = ?').get(member_id);
      eventColor = member?.color;
    }

    db.prepare(`
      INSERT INTO events (id, title, start_datetime, end_datetime, all_day, member_id, color, location, notes, important, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local')
    `).run(id, title, start_datetime, end_datetime, all_day ? 1 : 0, member_id || null, eventColor || null, location || null, notes || null, important ? 1 : 0);

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    res.status(201).json(event);
  }
);

// PUT /api/events/:id - update a local event
router.put('/:id',
  body('title').optional().trim().notEmpty(),
  body('start_datetime').optional().isISO8601(),
  body('end_datetime').optional().isISO8601(),
  validate,
  (req, res) => {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.source === 'google') return res.status(400).json({ error: 'Google events must be edited in Google Calendar' });

    // Holiday events: only the important flag can be changed
    if (event.source === 'holiday') {
      if (req.body.important === undefined) {
        return res.status(400).json({ error: 'Holiday events can only have their important flag toggled' });
      }
      db.prepare("UPDATE events SET important = ?, updated_at = datetime('now') WHERE id = ?")
        .run(req.body.important ? 1 : 0, req.params.id);
      return res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id));
    }

    const fields = ['title', 'start_datetime', 'end_datetime', 'all_day', 'member_id', 'color', 'location', 'notes', 'important'];
    const updates = [];
    const values = [];

    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    });

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    updates.push("updated_at = datetime('now')");
    values.push(req.params.id);

    db.prepare(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id));
  }
);

// DELETE /api/events/:id
router.delete('/:id', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.source === 'google')  return res.status(400).json({ error: 'Google events must be deleted in Google Calendar' });
  if (event.source === 'holiday') return res.status(400).json({ error: 'Holiday events cannot be deleted' });

  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
