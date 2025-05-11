const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = 3000;

// SQLiteデータベースの作成（または接続）
const db = new sqlite3.Database('./database.db');

// EJSをテンプレートエンジンとして使用
app.set('view engine', 'ejs');
app.set('views', './views');  // viewsフォルダを指定

// 静的ファイル（CSSなど）の提供設定
app.use(express.static('public'));

// JSONを受け取れるように設定
app.use(express.json());

// データベーステーブルの作成（初回のみ）
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS threads (id INTEGER PRIMARY KEY, title TEXT, description TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS replies (id INTEGER PRIMARY KEY, thread_id INTEGER, reply TEXT, FOREIGN KEY(thread_id) REFERENCES threads(id))");
});

// スレッドの一覧を取得
app.get('/threads', (req, res) => {
  db.all("SELECT * FROM threads", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.render('index', { threads: rows });  // EJSテンプレートにデータを渡してレンダリング
    }
  });
});

// スレッドを作成
app.post('/threads', (req, res) => {
  const { title, description } = req.body;
  const stmt = db.prepare("INSERT INTO threads (title, description) VALUES (?, ?)");
  stmt.run(title, description, function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ id: this.lastID, title, description });
    }
  });
  stmt.finalize();
});

// スレッドの詳細ページ（IDに基づいて表示）
app.get('/threads/:id', (req, res) => {
  const threadId = req.params.id;

  // スレッドの情報を取得
  db.get("SELECT * FROM threads WHERE id = ?", [threadId], (err, thread) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else if (!thread) {
      res.status(404).json({ error: 'スレッドが見つかりませんでした' });
    } else {
      // レスの情報を取得
      db.all("SELECT * FROM replies WHERE thread_id = ?", [threadId], (err, replies) => {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          // thread_detail.ejsをレンダリング
          res.render('thread_detail', { thread: thread, replies: replies });
        }
      });
    }
  });
});

// スレッドにレスを投稿
app.post('/threads/:id/replies', (req, res) => {
  const threadId = req.params.id;
  const { reply } = req.body;
  const stmt = db.prepare("INSERT INTO replies (thread_id, reply) VALUES (?, ?)");
  stmt.run(threadId, reply, function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ id: this.lastID, thread_id: threadId, reply });
    }
  });
  stmt.finalize();
});

// サーバーの起動
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
