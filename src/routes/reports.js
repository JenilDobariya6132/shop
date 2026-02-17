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

function monthRange(year, month) {
  const y = Number(year);
  const m = Number(month);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

router.get('/monthly', async (req, res) => {
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const now = new Date();
    const month = String(req.query.month || String(now.getMonth() + 1).padStart(2, '0')).padStart(2, '0');
    const year = String(req.query.year || now.getFullYear());
    const { from, to } = monthRange(year, month);

    const [rows] = await pool.query(
      `
      SELECT 
        c.id AS customer_id,
        c.name AS customer_name,
        i.id AS item_id,
        i.name AS item_name,
        b.id AS bill_id,
        b.bill_number,
        b.bill_date,
        SUM(bi.quantity) AS quantity,
        SUM(bi.total) AS amount,
        CASE WHEN b.grand_total > 0 
             THEN SUM(bi.total) / b.grand_total * b.paid_amount
             ELSE 0 END AS paid_alloc,
        CASE WHEN b.grand_total > 0 
             THEN SUM(bi.total) / b.grand_total * b.pending_amount
             ELSE 0 END AS pending_alloc
      FROM bills b
      JOIN customers c ON b.customer_id = c.id
      JOIN bill_items bi ON bi.bill_id = b.id
      JOIN items i ON bi.item_id = i.id
      WHERE b.bill_date >= ? AND b.bill_date < ? AND b.user_id = ?
      GROUP BY c.id, i.id, b.id
      ORDER BY c.name ASC, i.name ASC, b.bill_date ASC, b.id ASC
      `,
      [from, to, payload.uid]
    );

    let totals = { quantity: 0, amount: 0, paid: 0, pending: 0 };
    for (const r of rows) {
      totals.quantity += Number(r.quantity || 0);
      totals.amount += Number(r.amount || 0);
      totals.paid += Number(r.paid_alloc || 0);
      totals.pending += Number(r.pending_alloc || 0);
    }

    res.set('Cache-Control', 'no-store');
    res.json({
      month,
      year,
      range: { from, to: new Date(new Date(to).getTime() - 86400000).toISOString().slice(0, 10) },
      rows,
      totals: {
        quantity: Number(totals.quantity.toFixed(2)),
        amount: Number(totals.amount.toFixed(2)),
        paid: Number(totals.paid.toFixed(2)),
        pending: Number(totals.pending.toFixed(2)),
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/outstanding', async (req, res) => {
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const { from, to, search } = req.query;
    const whereBills = [];
    const params = [];
    if (from) { whereBills.push('b.bill_date >= ?'); params.push(from); }
    if (to) { whereBills.push('b.bill_date <= ?'); params.push(to); }
    const billsFilter = `${whereBills.length ? `AND ${whereBills.join(' AND ')}` : ''} AND b.user_id = ?`;
    const searchWhere = [];
    const searchParams = [];
    if (search) {
      searchWhere.push('(c.name LIKE ? OR c.phone LIKE ? OR c.gst_id LIKE ?)');
      const q = `%${search}%`;
      searchParams.push(q, q, q);
    }
    const searchSql = searchWhere.length ? `WHERE ${searchWhere.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `
      SELECT 
        c.id AS customer_id,
        c.name AS customer_name,
        c.phone,
        c.gst_id,
        COUNT(b.id) AS bills_count,
        COALESCE(SUM(b.grand_total), 0) AS total_grand,
        COALESCE(SUM(b.paid_amount), 0) AS total_paid,
        COALESCE(SUM(b.pending_amount), 0) AS total_pending
      FROM customers c
      LEFT JOIN bills b ON b.customer_id = c.id ${billsFilter}
      ${searchSql}
      GROUP BY c.id
      ORDER BY total_pending DESC, c.name ASC
      `,
      [...params, payload.uid, ...searchParams]
    );
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/outstanding/:customerId', async (req, res) => {
  try {
    const payload = requireAuth(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    const { from, to } = req.query;
    const { customerId } = req.params;
    const where = ['b.customer_id = ?'];
    const params = [customerId];
    if (from) { where.push('b.bill_date >= ?'); params.push(from); }
    if (to) { where.push('b.bill_date <= ?'); params.push(to); }
    const [rows] = await pool.query(
      `
      SELECT b.id, b.bill_number, b.bill_date, b.grand_total, b.paid_amount, b.pending_amount
      FROM bills b
      WHERE ${where.join(' AND ')} AND b.user_id = ?
      ORDER BY b.bill_date DESC, b.id DESC
      `,
      [...params, payload.uid]
    );
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
