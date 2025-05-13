const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
app.use(express.urlencoded({ extended: true })); 
const crypto = require('crypto');

// SQLite データベース接続
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
  if (err) {
    console.error('データベース接続エラー:', err);
  } else {
    console.log('データベース接続成功');
  }
});

// ミドルウェア
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// --- テーブル作成 ---
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS clubs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      description TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      club_id INTEGER,
      title TEXT,
      description TEXT,
      created_at TEXT,
      deletePassword TEXT,
      FOREIGN KEY(club_id) REFERENCES clubs(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER,
      text TEXT,
      name TEXT,
      created_at TEXT,
      anon_id TEXT,
      ip_address TEXT,
      FOREIGN KEY(thread_id) REFERENCES threads(id)
    )
  `);
  const crypto = require('crypto');
  app.set('trust proxy', true);
  
  
  // 初期部活データの挿入
  db.get('SELECT COUNT(*) AS count FROM clubs', (err, row) => {
    if (row.count === 0) {
      const clubs = [
        { name: 'ニート部', description: 'ニートの集まり' },
        { name: '暇部', description: '暇人集合' },
        { name: '愚痴部', description: '日頃の愚痴を吐き出す場所' },
        { name: '腐女子部', description: '腐女子による腐女子のための' },
        { name: '討論部', description: '熱く議論したい人たちへ' },
        { name: '恋愛部', description: '恋バナしよ' },
        { name: '勉強部', description: '一緒に勉強しよう' },
        { name: 'おもしろ部', description: '笑いたい人集まれ' },
        { name: 'なんｚ', description: 'なんでも実況' },
        { name: 'ｖｉｐ', description: 'VIPPERたちのたまり場' }
      ];
      const stmt = db.prepare('INSERT INTO clubs (name, description) VALUES (?, ?)');
      clubs.forEach(club => stmt.run(club.name, club.description));
      stmt.finalize();
      console.log('初期部活データを挿入しました');
    }
  });
});

// トップページ：部活一覧
app.get('/', (req, res) => {
  db.all('SELECT * FROM clubs ORDER BY name', [], (err, clubs) => {
    if (err) return res.status(500).send('データベースエラー');
    res.render('index', { clubs });
  });
});

// 部活ページ：スレッド一覧（ページネーション＋ソート）
app.get('/clubs/:club_id', (req, res) => {
  const club_id = req.params.club_id;
  const sort = req.query.sort || 'newest';
  const currentPage = parseInt(req.query.page) || 1;
  const itemsPerPage = 10;
  const offset = (currentPage - 1) * itemsPerPage;

  db.get('SELECT * FROM clubs WHERE id = ?', [club_id], (err, club) => {
    if (err || !club) return res.status(404).send('部活が見つかりません');

    let query = `
    SELECT 
      threads.id, 
      threads.title, 
      threads.description, 
      threads.created_at,
      COUNT(responses.id) AS response_count
    FROM threads
    LEFT JOIN responses ON threads.id = responses.thread_id
    WHERE threads.club_id = ?
    GROUP BY threads.id
  `;
  
  query += sort === 'popular' ? ' ORDER BY response_count DESC' : ' ORDER BY threads.created_at DESC';
  query += ' LIMIT ? OFFSET ?';
  
  
    db.all(query, [club_id, itemsPerPage, offset], (err, threads) => {
      if (err) return res.status(500).send('スレッド取得エラー');
      db.get('SELECT COUNT(*) AS count FROM threads WHERE club_id = ?', [club_id], (err, countResult) => {
        if (err) return res.status(500).send('件数取得エラー');
        const totalPages = Math.ceil(countResult.count / itemsPerPage);
        res.render('club_detail', { club, threads, sort, currentPage, totalPages });
      });
    });
  });
});

// スレッド作成ページ
app.get('/clubs/:club_id/threads/new', (req, res) => {
  db.get('SELECT * FROM clubs WHERE id = ?', [req.params.club_id], (err, club) => {
    if (err || !club) return res.status(404).send('部活が見つかりません');
    res.render('create_thread', { club, error: null }); // error を明示的に渡す

  });
});
app.post('/confirm-thread', (req, res) => {
  const { title, description, clubId, deletePassword } = req.body;
  res.render('alert_thread', { title, description, clubId, deletePassword });  
});

app.get('/success-thread', (req, res) => {
  const threadId = req.query.threadId;
  const clubId = req.query.clubId; // ← 追加
  res.render('success_thread', { threadId, clubId }); // ← 追加
});


// 部活一覧表示
app.get('/clubs', (req, res) => {
  db.all('SELECT * FROM clubs', (err, clubs) => {
    if (err) return res.status(500).send('部活一覧の取得に失敗しました');
    res.render('index', { clubs }); // index.ejs を使って部活一覧を表示
  });
});
// 特定の部活に紐づくスレッド一覧表示
app.get('/clubs/:club_id/threads', (req, res) => {
  const club_id = req.params.club_id;
  const sort = req.query.sort || 'newest';
  const page = parseInt(req.query.page) || 1;
  const threadsPerPage = 10;
  const offset = (page - 1) * threadsPerPage;

  db.get('SELECT * FROM clubs WHERE id = ?', [club_id], (err, club) => {
    if (err || !club) return res.status(404).send('部活が見つかりません');

    // 総スレッド数取得
    db.get('SELECT COUNT(*) AS count FROM threads WHERE club_id = ?', [club_id], (err, countRow) => {
      if (err) return res.status(500).send('スレッド数の取得に失敗しました');

      const totalThreads = countRow.count;
      const totalPages = Math.ceil(totalThreads / threadsPerPage);

      // 並び順を切り替え
      let orderBy = 'created_at DESC';
      if (sort === 'popular') orderBy = 'response_count DESC';

      db.all(
        `SELECT * FROM threads WHERE club_id = ? ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        [club_id, threadsPerPage, offset],
        (err, threads) => {
          if (err) return res.status(500).send('スレッド一覧の取得に失敗しました');

          res.render('club_detail', {
            club,
            threads,
            currentPage: page,
            totalPages,
            sort
          });
        }
      );
    });
  });
});



// スレッド作成処理
app.post('/clubs/:club_id/threads', (req, res) => {
  const club_id = req.params.club_id; // ★ これが必要
  const { title, description, deletePassword } = req.body;

  if (!title || !description || !deletePassword) {
    return res.status(400).send('タイトル・内容・削除用パスワードは必須です');
  }

  const now = new Date();
  const createdAt = getJapanTime(); // ★ 作成時間も定義する必要があります

  db.run(
    'INSERT INTO threads (club_id, title, description, created_at, deletePassword) VALUES (?, ?, ?, ?, ?)',
    [club_id, title, description, createdAt, deletePassword],
    function (err) {
      if (err) return res.status(500).send('スレッド作成に失敗しました');

      const threadId = this.lastID;
      const name = '名無しの学生';

      const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
      const formattedTime = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${weekdays[now.getDay()]}） ${now.getHours()}時${now.getMinutes()}分`;
      function getClientIp(req) {
        const forwarded = req.headers['x-forwarded-for'];
        return forwarded ? forwarded.split(',')[0].trim() : req.connection.remoteAddress || req.ip;
      }
      
      const ip = getClientIp(req);
      const dateStr = new Date().toISOString().split('T')[0];
      const anonId = generateAnonId(ip, dateStr);
      db.run(
        'INSERT INTO responses (thread_id, text, created_at, name, anon_id, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [threadId, description, formattedTime, name, anonId, ip],
      
        (err2) => {
          if (err2) return res.status(500).send('1レス目の作成に失敗しました');
          res.redirect(`/success-thread?threadId=${threadId}&clubId=${club_id}`);
        }
      );
    }
  );
});


app.get('/threads/:id', (req, res) => {
  db.get('SELECT * FROM threads WHERE id = ?', [req.params.id], (err, thread) => {
    if (err || !thread) return res.status(404).send('スレッドが見つかりません');
    
    
    db.all(
        'SELECT * FROM responses WHERE thread_id = ? ORDER BY id ASC',
      [thread.id],
       (err, responses) => {
      if (err) return res.status(500).send('レス取得エラー');
      
      // 成功メッセージを渡す
      const successMessage = req.query.success || null;

      res.render('thread_detail', { thread, responses, success: successMessage });
    });
  });
});


// 投稿前の確認画面
app.get('/threads/:id/alert', (req, res) => {
  res.render('alert', { threadId: req.params.id });
});
function generateAnonId(ip, dateStr) {
  const hash = crypto.createHash('sha256');
  hash.update(ip + dateStr); // IPアドレスと日付を結合
  return hash.digest('hex').slice(0, 16); // 最初の16文字を仮IDとして使用
}

// レス投稿処理
// クライアントのIPアドレスを取得する関数
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : req.connection.remoteAddress || req.ip;
}

app.post('/threads/:id/responses', (req, res) => {
  const threadId = req.params.id;
  const content = req.body.content?.trim();
  const name = req.body.name?.trim() || '名無しの学生';

  const now = new Date();
  const weekdays = ['日','月','火','水','木','金','土'];
  const formattedTime = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日（${weekdays[now.getDay()]}） `
    + `${now.getHours()}時${now.getMinutes()}分`;

  const ip = getClientIp(req);  // クライアントIPを取得
  const dateStr = now.toISOString().split('T')[0];  // 今日の日付
  const anonId = generateAnonId(ip, dateStr);  // 仮IDを生成

  db.run(
    'INSERT INTO responses (thread_id, text, created_at, name, anon_id, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [threadId, content, formattedTime, name, anonId, ip],
    (err) => {
      if (err) return res.status(500).send('レス保存に失敗しました');
      res.redirect(`/threads/${threadId}/success`);
    }
  );
});

// 確認画面（フォーム送信 → 投稿前に alert.ejs を表示）
app.post('/alert', (req, res) => {
  const { threadId, name, content } = req.body;

  // バリデーション
  if (!content || !threadId) return res.status(400).send('不正な入力です');

  res.render('alert', { threadId, name, content });
});

// レス投稿後に success.ejs を表示
app.get('/threads/:id/success', (req, res) => {
  const threadId = req.params.id;

  db.get('SELECT * FROM threads WHERE id = ?', [threadId], (err, thread) => {
    if (err || !thread) return res.status(404).send('スレッドが見つかりません');
    res.render('success', { threadId });
  });
});

app.post('/threads/:id/delete', (req, res) => {
  const threadId = req.params.id;
  const inputPassword = req.body.deletePassword; // フォームのinput nameに合わせる

  db.get('SELECT deletePassword, club_id FROM threads WHERE id = ?', [threadId], (err, row) => {
    if (err || !row) {
      return res.status(404).send('スレッドが見つかりません');
    }

    if (row.deletePassword !== inputPassword) {
      return res.status(403).send('削除用パスワードが違います');
    }

    // 関連レス削除
    db.run('DELETE FROM responses WHERE thread_id = ?', [threadId], (err1) => {
      if (err1) {
        return res.status(500).send('レス削除に失敗しました');
      }

      // スレッド削除
      db.run('DELETE FROM threads WHERE id = ?', [threadId], (err2) => {
        if (err2) {
          return res.status(500).send('スレッド削除に失敗しました');
        }

        // 完了画面を表示（テンプレート）
        res.render('delete_success', {
          message: 'スレッドが正常に削除されました。',
          clubId: row.club_id
        });
      });
    });
  });
});


// 日本時間取得関数
function getJapanTime() {
  const options = {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  const japanTime = new Date().toLocaleString('ja-JP', options);
  return japanTime.replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/, '$3-$1-$2 $4:$5:$6');
}


// サーバー起動
app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});


