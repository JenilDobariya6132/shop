const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function run() {
  const sqlPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const sqlText = fs.readFileSync(sqlPath, 'utf8');
  const statements = sqlText
    .split(/;[\r\n]+/)
    .map(s => s.trim())
    .filter(s => s.length);

  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Jenil@2007',
    multipleStatements: true
  });
  try {
    for (const stmt of statements) {
      await conn.query(stmt);
    }
    console.log('Database schema and sample data loaded successfully.');
  } catch (err) {
    console.error('Error loading schema:', err.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

run();
