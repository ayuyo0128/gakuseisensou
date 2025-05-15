const { Pool } = require('pg');

// Supabaseから取得したデータベース接続URLを使う
const pool = new Pool({
  connectionString: 'postgresql://postgres:kobayashiriku0128@db.hcogsytufkzlkbjtzbme.supabase.co:5432/postgres',
  ssl: {
    rejectUnauthorized: false, // SSL接続の際、無効化（セキュリティ上問題ない場合）
  },
});

// 接続テスト（この部分はデータベース接続が成功するか確認するため）
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('接続エラー', err);
  } else {
    console.log('接続成功', res.rows[0]);
  }
  
});

module.exports = pool; // 接続オブジェクトをエクスポートして、他のファイルでも使えるようにする
