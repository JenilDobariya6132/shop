const express = require('express');
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
    const [rows] = await pool.query('SELECT * FROM customers WHERE user_id=? ORDER BY id DESC', [payload.uid]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { name, gst_id, phone, address } = req.body;
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const [result] = await pool.query(
      'INSERT INTO customers (name, gst_id, phone, address, user_id) VALUES (?, ?, ?, ?, ?)',
      [name, gst_id, phone, address, payload.uid]
    );
    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ? AND user_id=?', [result.insertId, payload.uid]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const id = req.params.id;
  const { name, gst_id, phone, address } = req.body;
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const [updateRes] = await pool.query(
      'UPDATE customers SET name=?, gst_id=?, phone=?, address=? WHERE id=? AND user_id=?',
      [name, gst_id, phone, address, id, payload.uid]
    );
    if (updateRes.affectedRows === 0) return res.status(404).json({ error: 'Customer not found' });
    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ? AND user_id=?', [id, payload.uid]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  const force = String(req.query.force || '').toLowerCase() === 'true';
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    // Check if customer exists
    const [custRows] = await pool.query('SELECT id FROM customers WHERE id=? AND user_id=?', [id, payload.uid]);
    if (custRows.length === 0) return res.status(404).json({ error: 'Customer not found' });

    // Count bills
    const [countRows] = await pool.query('SELECT COUNT(*) AS cnt FROM bills WHERE customer_id=? AND user_id=?', [id, payload.uid]);
    const billCount = Number(countRows[0]?.cnt || 0);

    if (billCount > 0 && !force) {
      return res.status(409).json({ error: 'Cannot delete customer with existing bills. You can delete all their bills first, or use force delete.' });
    }

    // If force, cascade delete bills and restore stock
    if (billCount > 0 && force) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        // Find all bills for this customer
        const [bills] = await conn.query('SELECT id FROM bills WHERE customer_id=? AND user_id=?', [id, payload.uid]);
        for (const b of bills) {
          const billId = b.id;
          // Delete bill_items then bill
          await conn.query('DELETE FROM bill_items WHERE bill_id=?', [billId]);
          await conn.query('DELETE FROM bills WHERE id=?', [billId]);
        }
        // Delete the customer
        await conn.query('DELETE FROM customers WHERE id=? AND user_id=?', [id, payload.uid]);
        await conn.commit();
        conn.release();
        return res.json({ success: true, id, deletedBills: billCount });
      } catch (err) {
        // Rollback on any error
        try { await conn.rollback(); conn.release(); } catch {}
        return res.status(500).json({ error: err.message });
      }
    }

    // No bills, safe to delete
    await pool.query('DELETE FROM customers WHERE id=? AND user_id=?', [id, payload.uid]);
    return res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
