const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

// スレッド作成フォーム表示
router.get('/clubs/:clubId/threads/new', (req, res) => {
  const clubId = req.params.clubId;

  db.get('SELECT * FROM clubs WHERE id = ?', [clubId], (err, club) => {
    if (err || !club) {
      return res.status(404).send("部活が見つかりません");
    }

    res.render('create_thread', { club });
  });
});

// スレッド作成
router.post('/clubs/:clubId/threads', (req, res) => {
  const clubId = req.params.clubId;
  const { title, content } = req.body;
  const createdAt = new Date().toISOString();

  db.run(
    'INSERT INTO threads (club_id, title, content, created_at, responses) VALUES (?, ?, ?, ?, ?)',
    [clubId, title, content, createdAt, 0], // 初期レス数は0
    function(err) {
      if (err) {
        return res.status(500).send("スレッド投稿エラー");
      }

      res.redirect(`/clubs/${clubId}/threads`);
    }
  );
});

// スレッド詳細ページ表示
router.get('/threads/:threadId', (req, res) => {
  const threadId = req.params.threadId;

  db.get('SELECT * FROM threads WHERE id = ?', [threadId], (err, thread) => {
    if (err || !thread) {
      return res.status(404).send("スレッドが見つかりません");
    }

    db.all('SELECT * FROM responses WHERE thread_id = ?', [threadId], (err2, responses) => {
      if (err2) {
        return res.status(500).send("レス取得エラー");
      }

      res.render('thread_detail', { thread, responses });
    });
  });
});

// レス投稿
router.post('/threads/:threadId/responses', (req, res) => {
  const threadId = req.params.threadId;
  const { content } = req.body;
  const createdAt = new Date().toISOString();

  db.run(
    'INSERT INTO responses (thread_id, content, created_at) VALUES (?, ?, ?)',
    [threadId, content, createdAt],
    function (err) {
      if (err) {
        return res.status(500).send("レス投稿エラー");
      }

      // レス数カウントを1加算
      db.run('UPDATE threads SET responses = responses + 1 WHERE id = ?', [threadId]);

      res.redirect(`/threads/${threadId}`);
    }
  );
});

module.exports = router;
