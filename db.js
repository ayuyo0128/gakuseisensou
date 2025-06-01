require('dotenv').config(); 
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:kobayashiriku0128@db.hcogsytufkzlkbjtzbme.supabase.co:5432/postgres',
  ssl: {
    rejectUnauthorized: false,
  },
});

module.exports = pool;
