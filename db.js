const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  host: `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`, // ✅ ここが超重要
  port: 5432,
});

module.exports = pool;
