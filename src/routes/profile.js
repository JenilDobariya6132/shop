const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('../db');

const router = express.Router();
const SECRET = process.env.AUTH_SECRET || 'dev-secret';

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
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

router.get('/me', async (req, res) => {
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const [rows] = await pool.query('SELECT * FROM company_profiles WHERE user_id=?', [payload.uid]);
    if (rows.length === 0) return res.json(null);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const { company_name, address, phone, phone2, email, logo_data } = req.body;
    if (!company_name) return res.status(400).json({ error: 'Company name is required' });
    let logoUrl = null;
    if (logo_data && typeof logo_data === 'string' && logo_data.startsWith('data:')) {
      const m = logo_data.match(/^data:(image\/(png|jpeg|jpg));base64,(.*)$/i);
      if (m) {
        const mime = m[1];
        const buf = Buffer.from(m[3], 'base64');
        const ext = mime.includes('png') ? 'png' : 'jpg';
        const dir = path.join(__dirname, '..', '..', 'public', 'company_logos');
        try { fs.mkdirSync(dir, { recursive: true }); } catch {}
        const filename = `user_${payload.uid}.${ext}`;
        const fullPath = path.join(dir, filename);
        fs.writeFileSync(fullPath, buf);
        logoUrl = `/company_logos/${filename}`;
      }
    }
    const [exists] = await pool.query('SELECT id FROM company_profiles WHERE user_id=?', [payload.uid]);
    if (exists.length === 0) {
      const [result] = await pool.query(
        'INSERT INTO company_profiles (user_id, company_name, address, phone, phone2, email, logo_url, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [payload.uid, company_name, address || null, phone || null, phone2 || null, email || null, logoUrl]
      );
      return res.status(201).json({ id: result.insertId, user_id: payload.uid, company_name, address, phone, email, logo_url: logoUrl });
    } else {
      const fields = ['company_name=?', 'address=?', 'phone=?', 'phone2=?', 'email=?'];
      const vals = [company_name, address || null, phone || null, phone2 || null, email || null];
      if (logoUrl) { fields.push('logo_url=?'); vals.push(logoUrl); }
      vals.push(payload.uid);
      await pool.query(`UPDATE company_profiles SET ${fields.join(', ')}, updated_at=NOW() WHERE user_id=?`, vals);
      const [rows] = await pool.query('SELECT * FROM company_profiles WHERE user_id=?', [payload.uid]);
      return res.json(rows[0]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
