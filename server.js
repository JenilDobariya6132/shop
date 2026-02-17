const express = require('express');
const path = require('path');
const cors = require('cors');
const { pool } = require('./src/db');

const itemsRouter = require('./src/routes/items');
const customersRouter = require('./src/routes/customers');
const billsRouter = require('./src/routes/bills');
const reportsRouter = require('./src/routes/reports');
const authRouter = require('./src/routes/auth');
const profileRouter = require('./src/routes/profile');

const app = express();
const PORT = process.env.PORT || 3001;

async function ensurePaymentColumns() {
  try {
    await pool.query('SELECT paid_amount, pending_amount FROM bills LIMIT 1');
  } catch (err) {
    try {
      await pool.query(`ALTER TABLE bills ADD COLUMN paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00`);
    } catch (_) {}
    try {
      await pool.query(`ALTER TABLE bills ADD COLUMN pending_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00`);
    } catch (_) {}
  }
}

async function ensureItemsPhotoColumn() {
  try {
    await pool.query('SELECT photo_url FROM items LIMIT 1');
  } catch (err) {
    try {
      await pool.query(`ALTER TABLE items ADD COLUMN photo_url VARCHAR(255) NULL`);
    } catch (_) {}
  }
}

async function ensureOwnershipColumns() {
  const addCol = async (table) => {
    try { await pool.query(`SELECT user_id FROM ${table} LIMIT 1`); }
    catch (err) { try { await pool.query(`ALTER TABLE ${table} ADD COLUMN user_id INT NULL`); } catch (_) {} }
  };
  await addCol('customers');
  await addCol('items');
  await addCol('bills');
}

async function ensureIndexes() {
  const exec = async (sql) => { try { await pool.query(sql); } catch (_) {} };
  await exec('CREATE INDEX idx_bills_bill_number ON bills(bill_number)');
  await exec('CREATE INDEX idx_bills_bill_date ON bills(bill_date)');
  await exec('CREATE INDEX idx_bills_customer_id ON bills(customer_id)');
  await exec('CREATE INDEX idx_bills_paid ON bills(paid_amount)');
  await exec('CREATE INDEX idx_bills_pending ON bills(pending_amount)');
  await exec('CREATE INDEX idx_customers_name ON customers(name)');
  await exec('CREATE INDEX idx_customers_phone ON customers(phone)');
  await exec('CREATE INDEX idx_customers_uid ON customers(user_id)');
  await exec('CREATE INDEX idx_items_uid ON items(user_id)');
  await exec('CREATE INDEX idx_bills_uid ON bills(user_id)');
}

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
async function ensureCompanyProfiles() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_profiles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      company_name VARCHAR(255) NOT NULL,
      address VARCHAR(500),
      phone VARCHAR(50),
      phone2 VARCHAR(50),
      email VARCHAR(150),
      logo_url VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
}
async function ensureCompanyPhone2Column() {
  try {
    await pool.query('SELECT phone2 FROM company_profiles LIMIT 1');
  } catch (err) {
    try {
      await pool.query('ALTER TABLE company_profiles ADD COLUMN phone2 VARCHAR(50) NULL');
    } catch (_) {}
  }
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/items', itemsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/bills', billsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);

app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    res.json({ status: 'ok', db: rows[0].ok === 1 });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.listen(PORT, async () => {
  await ensurePaymentColumns();
  await ensureItemsPhotoColumn();
  await ensureOwnershipColumns();
  await ensureIndexes();
  await ensureUsersTable();
  await ensureCompanyProfiles();
  await ensureCompanyPhone2Column();
  console.log(`Server running at http://localhost:${PORT}`);
});
