const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../db');

const SECRET = process.env.AUTH_SECRET || 'dev-secret';
function fromBase64url(input) {
  input = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64');
}
function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(fromBase64url(body).toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
function requireAuth(req) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyToken(token);
  return payload;
}

router.get('/', async (req, res) => {
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const [rows] = await pool.query('SELECT * FROM items WHERE user_id=? ORDER BY id DESC', [payload.uid]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { name, size, price, quantity, photo_data } = req.body;
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const s = Number(size || 0);
    const p = Number(price || 0);
    const [result] = await pool.query(
      'INSERT INTO items (name, size, price, quantity, user_id) VALUES (?, ?, ?, ?, ?)',
      [name, s, p, quantity, payload.uid]
    );
    if (photo_data && typeof photo_data === 'string' && photo_data.startsWith('data:')) {
      try {
        const m = photo_data.match(/^data:(image\/(png|jpeg|jpg));base64,(.*)$/i);
        if (m) {
          const mime = m[1];
          const buf = Buffer.from(m[3], 'base64');
          const ext = mime.includes('png') ? 'png' : 'jpg';
          const dir = path.join(__dirname, '..', '..', 'public', 'item_photos');
          try { fs.mkdirSync(dir, { recursive: true }); } catch { }
          const filename = `item_${result.insertId}.${ext}`;
          const fullPath = path.join(dir, filename);
          fs.writeFileSync(fullPath, buf);
          const url = `/item_photos/${filename}`;
          try {
            await pool.query('UPDATE items SET photo_url=? WHERE id=?', [url, result.insertId]);
          } catch { }
        }
      } catch { }
    }
    const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const id = req.params.id;
  const { name, size, price, quantity, photo_data } = req.body;
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const s = Number(size || 0);
    const p = Number(price || 0);
    let photoUrl = null;
    if (photo_data && typeof photo_data === 'string' && photo_data.startsWith('data:')) {
      try {
        const m = photo_data.match(/^data:(image\/(png|jpeg|jpg));base64,(.*)$/i);
        if (m) {
          const mime = m[1];
          const buf = Buffer.from(m[3], 'base64');
          const ext = mime.includes('png') ? 'png' : 'jpg';
          const dir = path.join(__dirname, '..', '..', 'public', 'item_photos');
          try { fs.mkdirSync(dir, { recursive: true }); } catch { }
          const filename = `item_${id}.${ext}`;
          const fullPath = path.join(dir, filename);
          fs.writeFileSync(fullPath, buf);
          photoUrl = `/item_photos/${filename}`;
        }
      } catch { }
    }
    const fields = ['name=?', 'size=?', 'price=?', 'quantity=?'];
    const vals = [name, s, p, quantity];
    if (photoUrl) { fields.push('photo_url=?'); vals.push(photoUrl); }
    vals.push(id, payload.uid);
    const [updateRes] = await pool.query(`UPDATE items SET ${fields.join(', ')} WHERE id=? AND user_id=?`, vals);
    if (updateRes.affectedRows === 0) return res.status(404).json({ error: 'Item not found' });
    const [rows] = await pool.query('SELECT * FROM items WHERE id = ? AND user_id=?', [id, payload.uid]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const [delRes] = await pool.query('DELETE FROM items WHERE id=? AND user_id=?', [id, payload.uid]);
    if (delRes.affectedRows === 0) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
