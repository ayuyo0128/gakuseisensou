// db_setup.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db/club_app.db');  // データベースのパス

// clubs テーブル作成
db.run(`
  CREATE TABLE IF NOT EXISTS clubs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT
  )
`);

// threads テーブル作成
db.run(`
  CREATE TABLE IF NOT EXISTS threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    club_id INTEGER,
    FOREIGN KEY (club_id) REFERENCES clubs(id)
  )
`);

console.log("テーブルが作成されました！");
db.close();
