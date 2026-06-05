const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/database');

const router = express.Router();
const AVATAR_DIR = path.join(__dirname, '../../data/avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${req.params.id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only images allowed'));
  },
});


function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

function formatMember(m) {
  return {
    ...m,
    google_calendar_ids: JSON.parse(m.google_calendar_ids || '[]'),
    ical_urls: JSON.parse(m.ical_urls || '[]'),
    avatar_url: m.avatar_url || null,
    google_connected: Boolean(
      db.prepare('SELECT google_refresh_token FROM family_members WHERE id = ?').get(m.id)?.google_refresh_token
    ),
  };
}

// GET /api/members
router.get('/', (req, res) => {
  const members = db.prepare(`
    SELECT id, name, color, google_calendar_ids, ical_urls, avatar_url
    FROM family_members
    ORDER BY rowid
  `).all();
  res.json(members.map(formatMember));
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
    const m = db.prepare('SELECT id, name, color, google_calendar_ids, ical_urls, avatar_url FROM family_members WHERE id = ?').get(id);
    res.status(201).json(formatMember(m));
  }
);

// PUT /api/members/:id
router.put('/:id',
  body('name').optional().trim().notEmpty(),
  body('color').optional().matches(/^#[0-9a-fA-F]{6}$/),
  body('google_calendar_ids').optional().isArray(),
  body('ical_urls').optional().isArray(),
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

    const m = db.prepare('SELECT id, name, color, google_calendar_ids, ical_urls, avatar_url FROM family_members WHERE id = ?').get(req.params.id);
    res.json(formatMember(m));
  }
);

// POST /api/members/:id/avatar — upload avatar image
router.post('/:id/avatar', upload.single('avatar'), (req, res) => {
  const member = db.prepare('SELECT * FROM family_members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const avatarUrl = `/avatars/${req.file.filename}`;
  db.prepare("UPDATE family_members SET avatar_url = ?, updated_at = datetime('now') WHERE id = ?")
    .run(avatarUrl, req.params.id);

  res.json({ avatar_url: avatarUrl });
});

// DELETE /api/members/:id/avatar — remove avatar
router.delete('/:id/avatar', (req, res) => {
  const member = db.prepare('SELECT * FROM family_members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  if (member.avatar_url) {
    const filePath = path.join(__dirname, '../../public', member.avatar_url);
    try { fs.unlinkSync(filePath); } catch {}
    db.prepare("UPDATE family_members SET avatar_url = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(req.params.id);
  }

  res.json({ deleted: true });
});

// DELETE /api/members/:id
router.delete('/:id', (req, res) => {
  const member = db.prepare('SELECT * FROM family_members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  // Clean up avatar file if present
  if (member.avatar_url) {
    const filePath = path.join(__dirname, '../../public', member.avatar_url);
    try { fs.unlinkSync(filePath); } catch {}
  }

  db.prepare('DELETE FROM family_members WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
