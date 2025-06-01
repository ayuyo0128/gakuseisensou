require('dotenv').config();
const express = require('express');      
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const app = express();
const pool = require('./db'); // db.js のファイル名に合わせてパスを調整



app.set('trust proxy', true);
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// --- ユーティリティ関数 ---
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded
    ? forwarded.split(',')[0].trim()
    : req.connection.remoteAddress || req.ip;
}

function generateAnonId(ip, dateStr) {
  const hash = crypto.createHash('sha256');
  hash.update(ip + dateStr);
  return hash.digest('hex').slice(0, 6);
}

function getJapanTime() {
  const opts = {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  };
  const ja = new Date().toLocaleString('ja-JP', opts);
  return ja.replace(/(\d+)\/(\d+)\/(\d+)\s(\d+):(\d+):(\d+)/, '$1-$2-$3 $4:$5:$6');
}

// --- 起動時：テーブル作成 & 初期データ挿入 ---
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clubs (
        id SERIAL PRIMARY KEY,
        name TEXT,
        description TEXT
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS threads (
        id SERIAL PRIMARY KEY,
        club_id INTEGER REFERENCES clubs(id),
        title TEXT,
        description TEXT,
        created_at TIMESTAMP,
        deletePassword TEXT
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS responses (
        id SERIAL PRIMARY KEY,
        thread_id INTEGER REFERENCES threads(id),
        text TEXT,
        name TEXT,
        created_at TIMESTAMP,
        anon_id TEXT,
        ip_address TEXT,
        delete_password TEXT
      )
    `);

    const { rows } = await pool.query('SELECT COUNT(*) FROM clubs');
    if (parseInt(rows[0].count, 10) === 0) {
      const initClubs = [
        ['ニート部','ニートの集まり'],['暇部','暇人集合'],['愚痴部','日頃の愚痴を吐き出す場所'],
        ['腐女子部','腐女子による腐女子のための'],['討論部','熱く議論したい人たちへ'],
        ['恋愛部','恋バナしよ'],['勉強部','一緒に勉強しよう'],['おもしろ部','笑いたい人集まれ'],
        ['なんｚ','なんでも実況'],['ｖｉｐ','VIPPERたちのたまり場']
      ];
      for (const [n,d] of initClubs) {
        await pool.query('INSERT INTO clubs (name,description) VALUES ($1,$2)', [n,d]);
      }
      console.log('初期部活データを挿入しました');
    }
  } catch (err) {
    console.error('テーブル初期化エラー:', err);
  }
})();

// --- ルーティング ---

// トップページ：部活一覧
app.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clubs ORDER BY name');
    res.render('index', { clubs: rows });
  } catch {
    res.status(500).send('データベースエラー');
  }
});

// alias：/clubs → /
app.get('/clubs', (req, res) => res.redirect('/'));

// 部活詳細：スレッド一覧（ページネーション＋ソート）
app.get('/clubs/:club_id', async (req, res) => {
  const clubId = parseInt(req.params.club_id, 10);
  const sort    = req.query.sort === 'popular'
                ? 'response_count DESC'
                : 'threads.created_at DESC';
  const page    = parseInt(req.query.page, 10) || 1;
  const limit   = 10;
  const offset  = (page - 1) * limit;

  try {
    const c = await pool.query('SELECT * FROM clubs WHERE id=$1', [clubId]);
    if (c.rows.length === 0) return res.status(404).send('部活が見つかりません');

    const q = `
      SELECT 
        threads.*, COUNT(responses.id) AS response_count
      FROM threads
      LEFT JOIN responses ON threads.id=responses.thread_id
      WHERE threads.club_id=$1
      GROUP BY threads.id
      ORDER BY ${sort}
      LIMIT $2 OFFSET $3
    `;
    const t = await pool.query(q, [clubId, limit, offset]);
    const cnt = await pool.query('SELECT COUNT(*) FROM threads WHERE club_id=$1', [clubId]);
    const totalPages = Math.ceil(parseInt(cnt.rows[0].count,10) / limit);

    res.render('club_detail', {
      club: c.rows[0],
      threads: t.rows,
      sort: req.query.sort || 'newest',
      currentPage: page,
      totalPages
    });
  } catch {
    res.status(500).send('スレッド取得エラー');
  }
});

// スレッド作成ページ
app.get('/clubs/:club_id/threads/new', async (req, res) => {
  try {
    const c = await pool.query('SELECT * FROM clubs WHERE id=$1', [req.params.club_id]);
    if (c.rows.length === 0) return res.status(404).send('部活が見つかりません');
    res.render('create_thread', { club: c.rows[0], error: null });
  } catch {
    res.status(500).send('サーバーエラー');
  }
});

// 投稿前確認画面
app.post('/confirm-thread', (req, res) => {
  const { title, description, clubId, deletePassword } = req.body;
  res.render('alert_thread', { title, description, clubId, deletePassword });
});

// スレッド作成処理
app.post('/clubs/:club_id/threads', async (req, res) => {
  const clubId = parseInt(req.params.club_id,10);
  const { title, description, deletePassword } = req.body;
  if (!title||!description||!deletePassword) {
    return res.status(400).send('タイトル・内容・削除用パスワードは必須です');
  }
  try {
    const now = getJapanTime();
    const ins = await pool.query(
      `INSERT INTO threads (club_id,title,description,created_at,deletePassword)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [clubId, title, description, now, deletePassword]
    );
    const threadId = ins.rows[0].id;
    const ip = getClientIp(req);
    const anon = generateAnonId(ip, now.split(' ')[0]);
    await pool.query(
      `INSERT INTO responses (thread_id,text,created_at,name,anon_id,ip_address,delete_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [threadId, description, now, '名無しの学生', anon, ip, deletePassword]
    );
    
    res.redirect(`/success-thread?threadId=${threadId}&clubId=${clubId}`);
  } catch {
    res.status(500).send('スレッド作成に失敗しました');
  }
});

// 作成完了
app.get('/success-thread', (req, res) => {
  res.render('success_thread', {
    threadId: req.query.threadId,
    clubId: req.query.clubId
  });
});

// スレッド詳細 + レス一覧
app.get('/threads/:id', async (req, res) => {
  const id = parseInt(req.params.id,10);
  try {
    const t = await pool.query('SELECT * FROM threads WHERE id=$1', [id]);
    if (t.rows.length === 0) return res.status(404).send('スレッドが見つかりません');
    const r = await pool.query('SELECT * FROM responses WHERE thread_id=$1 ORDER BY id', [id]);
    res.render('thread_detail', {
      thread: t.rows[0],
      responses: r.rows,
      success: req.query.success || null
    });
  } catch {
    res.status(500).send('レス取得エラー');
  }
});

// 投稿確認画面（alert.ejs を表示）
app.post('/alert', (req, res) => {
  const { threadId, name, content, delete_password } = req.body;

  if (!content || !threadId || !delete_password) {
    return res.status(400).send('不正な入力です');
  }

  res.render('alert', {
    threadId,
    name: name?.trim() || '名無しの学生',
    content: content.trim(),
    delete_password: delete_password.trim()
  });
});


// レス投稿（確認画面の「✅ 投稿する」ボタンから実行）
app.post('/threads/:id/responses', async (req, res) => {
  const tid = parseInt(req.params.id, 10);
  const name = req.body.name?.trim() || '名無しの学生';
  const content = req.body.content?.trim();
  const delete_password = req.body.delete_password?.trim(); // 👈 追加
  if (!content || !delete_password) return res.status(400).send('内容と削除用パスワードは必須です');

  try {
    const now = getJapanTime();
    const ip = getClientIp(req);
    const anon = generateAnonId(ip, now.split(' ')[0]);

    await pool.query(
      `INSERT INTO responses (thread_id, text, created_at, name, anon_id, ip_address, delete_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tid, content, now, name, anon, ip, delete_password]
    );

    res.redirect(`/threads/${tid}/success`);
  } catch (err) {
    console.error(err);
    res.status(500).send('レス保存に失敗しました');
  }
});


// レス投稿完了画面
app.get('/threads/:id/success', (req, res) => {
  res.render('success', { threadId: req.params.id });
});

// レス削除処理
app.post('/responses/:id/delete', async (req, res) => {
  const responseId = parseInt(req.params.id, 10);
  const inputPassword = req.body.delete_password;

  try {
    // データベースから対象レスを取得（delete_password が保存されている前提）
    const { rows } = await pool.query('SELECT * FROM responses WHERE id=$1', [responseId]);
    if (rows.length === 0) return res.status(404).send('レスが見つかりません');

    const response = rows[0];
    if (!response.delete_password) {
      return res.status(400).send('このレスは削除できません（パスワード未設定）');
    }

    // パスワード照合
    if (inputPassword !== response.delete_password) {
      return res.status(403).send('パスワードが違います');
    }

    // 削除処理
    await pool.query('DELETE FROM responses WHERE id=$1', [responseId]);

    res.redirect('back');
  } catch (err) {
    console.error('レス削除エラー:', err);
    res.status(500).send('サーバーエラー');
  }
});

// スレッド削除
app.post('/threads/:id/delete', async (req, res) => {
  const id = parseInt(req.params.id,10);
  const pw = req.body.deletePassword;
  try {
    const pr = await pool.query(
      'SELECT deletePassword, club_id FROM threads WHERE id=$1', [id]
    );
    if (!pr.rows.length || pr.rows[0].deletePassword !== pw) {
      return res.status(403).send('削除用パスワードが違います');
    }
    await pool.query('DELETE FROM responses WHERE thread_id=$1', [id]);
    await pool.query('DELETE FROM threads   WHERE id=$1', [id]);
    res.render('delete_success', {
      message: 'スレッドが正常に削除されました。',
      clubId: pr.rows[0].club_id
    });
  } catch {
    res.status(500).send('削除に失敗しました');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
