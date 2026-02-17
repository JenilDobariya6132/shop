const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');

const router = express.Router();

const SECRET = process.env.AUTH_SECRET || 'dev-secret';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromBase64url(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64');
}
function signToken(payload) {
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${body}.${sig}`;
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
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function checkPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const hash = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

router.post('/signup', async (req, res) => {
  try {
    const { username, password, company_name, address, phone, phone2, email } = req.body;
    if (!username || !password || password.length < 4) {
      return res.status(400).json({ error: 'Username and password (min 4 chars) required' });
    }
    if (!company_name || !address || !phone || !email) {
      return res.status(400).json({ error: 'Company name, address, phone and email are required' });
    }
    const [rows] = await pool.query('SELECT id FROM users WHERE username=?', [username]);
    if (rows.length > 0) return res.status(409).json({ error: 'Username already exists' });
    const pwd = hashPassword(password);
    const [result] = await pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, pwd]);
    const user = { id: result.insertId, username };
    try {
      await pool.query(
        'INSERT INTO company_profiles (user_id, company_name, address, phone, phone2, email, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
        [user.id, company_name, address || null, phone || null, phone2 || null, email || null]
      );
    } catch (e) {
      // best-effort: if this fails, continue with account creation
    }
    const token = signToken({ uid: user.id, u: user.username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.query('SELECT id, username, password_hash FROM users WHERE username=?', [username]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const row = rows[0];
    if (!checkPassword(password, row.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken({ uid: row.id, u: row.username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    res.json({ token, user: { id: row.id, username: row.username } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', async (req, res) => {
  try {
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const [rows] = await pool.query('SELECT id, username FROM users WHERE id=?', [payload.uid]);
    if (rows.length === 0) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
