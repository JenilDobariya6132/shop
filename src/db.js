const mysql = require('mysql2/promise');

const {
  MYSQL_HOST = 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
  MYSQL_USER = '2m3cdpP91FWEYX6.root',
  MYSQL_PASSWORD = 'mw0u8oWTbWKEFxTJ',
  MYSQL_DATABASE = 'workshop_db',
  MYSQL_PORT = '4000',
  MYSQL_SSL = 'true',
} = process.env;

const pool = mysql.createPool({
  host: MYSQL_HOST,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  port: Number(MYSQL_PORT),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: MYSQL_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

module.exports = { pool };
