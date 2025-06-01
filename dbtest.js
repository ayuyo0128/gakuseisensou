const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:kobayashiriku0128@db.hcogsytufkzlkbjtzbme.supabase.co:5432/postgres',
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ 接続エラー:', err);
  } else {
    console.log('✅ 接続成功:', res.rows[0]);
  }
  pool.end();
});
