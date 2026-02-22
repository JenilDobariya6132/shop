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
    const customerId = req.query.customer_id;
    const sql =
      `SELECT b.id, b.bill_number, b.bill_date, b.customer_id, c.name AS customer_name,
              b.subtotal, b.gst_percent, b.gst_amount, b.discount, b.grand_total,
              b.paid_amount, b.pending_amount
       FROM bills b
       JOIN customers c ON b.customer_id = c.id
       WHERE b.user_id = ?
       ${customerId ? ' AND b.customer_id = ?' : ''}
       ORDER BY b.id DESC`;
    const params = customerId ? [payload.uid, customerId] : [payload.uid];
    const [rows] = await pool.query(sql, params);
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search', async (req, res) => {
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const { name, bill_number, from, to, status, phone } = req.query;
    const where = [];
    const params = [];
    where.push('b.user_id = ?'); params.push(payload.uid);
    if (name) { where.push('c.name LIKE ?'); params.push(`%${name}%`); }
    if (bill_number) { where.push('b.bill_number LIKE ?'); params.push(`%${bill_number}%`); }
    if (from) { where.push('b.bill_date >= ?'); params.push(from); }
    if (to) { where.push('b.bill_date <= ?'); params.push(to); }
    if (phone) { where.push('c.phone LIKE ?'); params.push(`%${phone}%`); }
    if (status === 'Paid') { where.push('b.pending_amount = 0'); }
    else if (status === 'Unpaid') { where.push('b.paid_amount = 0'); }
    else if (status === 'Partial') { where.push('b.pending_amount > 0 AND b.paid_amount > 0'); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT b.id, b.bill_number, b.bill_date, c.name AS customer_name,
              b.grand_total, b.paid_amount, b.pending_amount,
              CASE
                WHEN b.pending_amount = 0 THEN 'Paid'
                WHEN b.paid_amount = 0 THEN 'Unpaid'
                ELSE 'Partial'
              END AS status
       FROM bills b
       JOIN customers c ON b.customer_id = c.id
       ${whereSql}
       ORDER BY b.bill_date DESC, b.id DESC
       LIMIT 500`,
      params
    );
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Update payment amounts only
router.patch('/:id/payment', async (req, res) => {
  const id = req.params.id;
  const { paid_amount = 0 } = req.body;
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const [rows] = await pool.query('SELECT grand_total FROM bills WHERE id=? AND user_id=?', [id, payload.uid]);
    if (rows.length === 0) return res.status(404).json({ error: 'Bill not found' });
    const grand = Number(rows[0].grand_total || 0);
    let paid = Number(paid_amount || 0);
    if (!Number.isFinite(paid) || paid < 0) paid = 0;
    if (paid > grand) paid = grand;
    const pending = grand - paid;
    await pool.query('UPDATE bills SET paid_amount=?, pending_amount=? WHERE id=? AND user_id=?', [paid, pending, id, payload.uid]);
    const [billRows] = await pool.query(
      `SELECT b.id, b.bill_number, b.bill_date, b.customer_id, c.name AS customer_name,
              b.subtotal, b.gst_percent, b.gst_amount, b.discount, b.grand_total,
              b.paid_amount, b.pending_amount
       FROM bills b
       JOIN customers c ON b.customer_id = c.id
       WHERE b.id = ? AND b.user_id = ?`,
      [id, payload.uid]
    );
    res.json({ bill: billRows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const [billRows] = await pool.query(
      `SELECT b.id, b.bill_number, b.bill_date, b.customer_id, c.name AS customer_name, c.gst_id, c.phone, c.address,
              b.subtotal, b.gst_percent, b.gst_amount, b.discount, b.grand_total,
              b.paid_amount, b.pending_amount
       FROM bills b
       JOIN customers c ON b.customer_id = c.id
       WHERE b.id = ? AND b.user_id = ?`,
      [id, payload.uid]
    );
    if (billRows.length === 0) return res.status(404).json({ error: 'Bill not found' });
    const [items] = await pool.query(
      `SELECT bi.item_id, i.name, bi.size, bi.quantity, bi.price, bi.total
       FROM bill_items bi
       JOIN items i ON bi.item_id = i.id
       WHERE bi.bill_id = ?`,
      [id]
    );
    res.set('Cache-Control', 'no-store');
    res.json({ bill: billRows[0], items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { bill_number, bill_date, customer_id, items, gst_percent = 18, discount = 0, paid_amount = 0 } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items array is required' });
  }
  const payload = requireAuth(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [custOwn] = await conn.query('SELECT id FROM customers WHERE id=? AND user_id=?', [customer_id, payload.uid]);
    if (custOwn.length === 0) throw new Error('Customer not found');
    // Compute per-item totals
    let subtotal = 0;
    for (const it of items) {
      const [rows] = await conn.query('SELECT id, price FROM items WHERE id=? AND (user_id=? OR user_id IS NULL)', [it.item_id, payload.uid]);
      if (rows.length === 0) {
        throw new Error(`Item ${it.item_id} not found`);
      }
      const dbItem = rows[0];
      const qty = Number(it.quantity);
      if (qty <= 0 || !Number.isFinite(qty)) {
        throw new Error(`Invalid quantity for item ${it.item_id}`);
      }
      const price = Number(it.price ?? dbItem.price);
      const total = price * qty;
      it.price = price;
      it.total = total;
      subtotal += total;
    }

    const gstAmount = (subtotal * Number(gst_percent)) / 100;
    const grandTotal = subtotal + gstAmount - Number(discount || 0);

    let paid = Number(paid_amount || 0);
    if (!Number.isFinite(paid) || paid < 0) paid = 0;
    if (paid > grandTotal) paid = grandTotal;
    const pending = grandTotal - paid;
    const [billResult] = await conn.query(
      `INSERT INTO bills (bill_number, bill_date, customer_id, subtotal, gst_percent, gst_amount, discount, grand_total, paid_amount, pending_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bill_number, bill_date, customer_id, subtotal, gst_percent, gstAmount, discount, grandTotal, paid, pending]
    );
    await conn.query('UPDATE bills SET user_id=? WHERE id=?', [payload.uid, billResult.insertId]);
    const billId = billResult.insertId;

    for (const it of items) {
      await conn.query(
        `INSERT INTO bill_items (bill_id, item_id, size, quantity, price, total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [billId, it.item_id, it.size, it.quantity, it.price, it.total]
      );
    }

    await conn.commit();

    const [billRows] = await pool.query(
      `SELECT b.id, b.bill_number, b.bill_date, b.customer_id, c.name AS customer_name,
              b.subtotal, b.gst_percent, b.gst_amount, b.discount, b.grand_total,
              b.paid_amount, b.pending_amount
       FROM bills b
       JOIN customers c ON b.customer_id = c.id
       WHERE b.id = ? AND b.user_id = ?`,
      [billId, payload.uid]
    );
    res.status(201).json({ bill: billRows[0] });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  const conn = await pool.getConnection();
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    await conn.beginTransaction();
    const [own] = await conn.query('SELECT id FROM bills WHERE id=? AND user_id=?', [id, payload.uid]);
    if (own.length === 0) { await conn.rollback(); return res.status(404).json({ error: 'Bill not found' }); }
    await conn.query('DELETE FROM bill_items WHERE bill_id=?', [id]);
    await conn.query('DELETE FROM bills WHERE id=? AND user_id=?', [id, payload.uid]);
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
// Update an existing bill
router.put('/:id', async (req, res) => {
  const id = req.params.id;
  const { bill_number, bill_date, customer_id, items, gst_percent = 18, discount = 0, paid_amount = 0 } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items array is required' });
  }
  const payload = requireAuth(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [own] = await conn.query('SELECT id FROM bills WHERE id=? AND user_id=?', [id, payload.uid]);
    if (own.length === 0) throw new Error('Bill not found');
    await conn.query('DELETE FROM bill_items WHERE bill_id=?', [id]);
    let subtotal = 0;
    for (const it of items) {
      const [rows] = await conn.query('SELECT id, price FROM items WHERE id=? AND (user_id=? OR user_id IS NULL)', [it.item_id, payload.uid]);
      if (rows.length === 0) {
        throw new Error(`Item ${it.item_id} not found`);
      }
      const dbItem = rows[0];
      const qty = Number(it.quantity);
      if (qty <= 0 || !Number.isFinite(qty)) {
        throw new Error(`Invalid quantity for item ${it.item_id}`);
      }
      const price = Number(it.price ?? dbItem.price);
      const total = price * qty;
      it.price = price;
      it.total = total;
      subtotal += total;
    }
    const gstAmount = (subtotal * Number(gst_percent)) / 100;
    const grandTotal = subtotal + gstAmount - Number(discount || 0);
    let paid = Number(paid_amount || 0);
    if (!Number.isFinite(paid) || paid < 0) paid = 0;
    if (paid > grandTotal) paid = grandTotal;
    const pending = grandTotal - paid;
    await conn.query(
      `UPDATE bills SET bill_number=?, bill_date=?, customer_id=?, subtotal=?, gst_percent=?, gst_amount=?, discount=?, grand_total=?, paid_amount=?, pending_amount=? WHERE id=?`,
      [bill_number, bill_date, customer_id, subtotal, gst_percent, gstAmount, discount, grandTotal, paid, pending, id]
    );
    for (const it of items) {
      await conn.query(
        `INSERT INTO bill_items (bill_id, item_id, size, quantity, price, total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, it.item_id, it.size, it.quantity, it.price, it.total]
      );
    }
    await conn.commit();
    const [billRows] = await pool.query(
      `SELECT b.id, b.bill_number, b.bill_date, b.customer_id, c.name AS customer_name,
              b.subtotal, b.gst_percent, b.gst_amount, b.discount, b.grand_total,
              b.paid_amount, b.pending_amount
       FROM bills b
       JOIN customers c ON b.customer_id = c.id
       WHERE b.id = ? AND b.user_id = ?`,
      [id, payload.uid]
    );
    res.json({ bill: billRows[0] });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});
