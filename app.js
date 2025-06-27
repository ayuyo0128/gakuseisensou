require('dotenv').config();
require('dns').setDefaultResultOrder('ipv4first');

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const fs = require('fs');
const multer = require('multer');

const pool = require('./db'); // ← db.js に統一

const app = express();

// ─── Multer 設定 ───
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const ok = allowedTypes.includes(file.mimetype);
    cb(ok ? null : new Error('画像ファイルのみアップロードできます（動画は不可）'), ok);
  }
});
(async () => {
  try {
    await pool.query(`ALTER TABLE responses ADD COLUMN IF NOT EXISTS image_filename TEXT`);
    console.log('image_filename カラムを確認・追加しました');
  } catch (err) {
    console.error('image_filename カラム追加時にエラー:', err.message);
  }
})();

app.set('trust proxy', true);
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '30d' })); // キャッシュ有効化
app.set('view engine', 'ejs');

// --- ユーティリティ関数 ---
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : req.connection.remoteAddress || req.ip;
}
function generateAnonId(ip, dateStr) {
  const hash = crypto.createHash('sha256');
  hash.update(ip + dateStr);
  return hash.digest('hex').slice(0, 6);
}
function getJapanTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
}
// 画像最適化ヘルパー
async function optimizeImage(originalPath, filename) {
  const compressedName = `compressed-${path.parse(filename).name}.webp`; // WebPに変換
  const outputPath = path.join('public/uploads', compressedName);

  await sharp(originalPath)
    .resize({ width: 960, withoutEnlargement: true }) // 最大幅を960に
    .webp({ quality: 60 }) // WebP形式で品質60（十分軽い＆綺麗）
    .toFile(outputPath);

  fs.unlinkSync(originalPath); // 元画像を削除
  return compressedName;
}

// --- テーブル初期化 ---
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clubs (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS threads (
        id SERIAL PRIMARY KEY,
        club_id INTEGER REFERENCES clubs(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TIMESTAMP,
        deletePassword TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS responses (
        id SERIAL PRIMARY KEY,
        thread_id INTEGER REFERENCES threads(id),
        text TEXT NOT NULL,
        name TEXT,
        created_at TIMESTAMP,
        anon_id TEXT,
        ip_address TEXT,
        delete_password TEXT,
        image_filename TEXT
      )
    `);

    const { rows } = await pool.query('SELECT COUNT(*) FROM clubs');
    if (parseInt(rows[0].count, 10) === 0) {
      const initClubs = [
        ['ニート部','ニートの集まり'],['暇部','暇人集合'],['愚痴部','日頃の愚痴を吐き出す場所'],
        ['腐女子部','腐女子による腐女子のための'],['討論部','熱く議論したい人たちへ'],
        ['恋愛部','恋バナしよ'],['勉強部','一緒に勉強しよう'],['おもしろ部','笑いたい人集まれ'],
        ['なんｚ','なんでも実況'],['ｖｉｐ','VIPPERたちのたまり場'],['自慢部'],['ヲたく部'],['オフ会部'],['授業なう部']
        ['美容部'],['趣味部'],['有益部'],['自己啓発部'],['流行部']
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
app.get('/', (req, res) => res.render('welcome'));

app.get('/clubs', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clubs ORDER BY name');
    res.render('index', { clubs: rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('データベースエラー');
  }
});

app.get('/clubs/:club_id', async (req, res) => {
  const clubId = parseInt(req.params.club_id, 10);
  const sort = req.query.sort === 'popular' ? 'popular' : 'newest';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = 30, offset = (page - 1) * limit;

  try {
    const c = await pool.query('SELECT * FROM clubs WHERE id=$1', [clubId]);
    if (!c.rows.length) return res.status(404).send('部活が見つかりません');

    let q;
    if (sort === 'popular') {
      // 直近24時間以内に立てられたスレッドでレス数が多い順
      q = `
        SELECT threads.*, COUNT(responses.id) AS response_count
        FROM threads
        LEFT JOIN responses ON threads.id = responses.thread_id
        WHERE threads.club_id = $1
          AND threads.created_at >= (NOW() AT TIME ZONE 'Asia/Tokyo') - INTERVAL '24 hours'
        GROUP BY threads.id
        ORDER BY response_count DESC
        LIMIT $2 OFFSET $3
      `;
    } else {
      // 新着順
      q = `
        SELECT threads.*, COUNT(responses.id) AS response_count
        FROM threads
        LEFT JOIN responses ON threads.id = responses.thread_id
        WHERE threads.club_id = $1
        GROUP BY threads.id
        ORDER BY threads.created_at DESC
        LIMIT $2 OFFSET $3
      `;
    }

    const t = await pool.query(q, [clubId, limit, offset]);
    const cnt = await pool.query('SELECT COUNT(*) FROM threads WHERE club_id=$1', [clubId]);
    const totalPages = Math.ceil(parseInt(cnt.rows[0].count, 10) / limit);

    res.render('club_detail', {
      club: c.rows[0],
      threads: t.rows,
      sort,
      currentPage: page,
      totalPages
    });
  } catch (err) {
    console.error('スレッド取得エラー:', err);
    res.status(500).send('スレッド取得エラー');
  }
});

app.get('/clubs/:club_id/threads/new', async (req, res) => {
  try {
    const c = await pool.query('SELECT * FROM clubs WHERE id=$1', [req.params.club_id]);
    if (!c.rows.length) return res.status(404).send('部活が見つかりません');
    res.render('create_thread', { club: c.rows[0], error: null });
  } catch (err) {
    console.error(err);
    res.status(500).send('サーバーエラー');
  }
});

app.post('/confirm-thread', (req, res) => {
  const { title, description, clubId, deletePassword } = req.body;
  res.render('alert_thread', { title, description, clubId, deletePassword });
});

app.post('/clubs/:club_id/threads', async (req, res) => {
  const clubId = parseInt(req.params.club_id,10);
  const { title, description, deletePassword } = req.body;
  if (!title || !description || !deletePassword)
    return res.status(400).send('タイトル・内容・削除用パスワードは必須です');

  try {
    const now = getJapanTime(), dateStr = now.toISOString().split('T')[0];
    const ins = await pool.query(
      `INSERT INTO threads (club_id,title,description,created_at,deletePassword)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [clubId, title, description, now, deletePassword]
    );
    const threadId = ins.rows[0].id;
    const ip = getClientIp(req), anon = generateAnonId(ip, dateStr);
    await pool.query(
      `INSERT INTO responses (thread_id,text,created_at,name,anon_id,ip_address,delete_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [threadId, description, now, '名無しの学生', anon, ip, deletePassword]
    );
    res.redirect(`/success-thread?threadId=${threadId}&clubId=${clubId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('スレッド作成に失敗しました');
  }
});

app.get('/success-thread', (req, res) => {
  res.render('success_thread', { threadId: req.query.threadId, clubId: req.query.clubId });
});

app.get('/threads/:id', async (req, res) => {
  const id = parseInt(req.params.id,10);
  try {
    const t = await pool.query('SELECT * FROM threads WHERE id=$1', [id]);
    if (!t.rows.length) return res.status(404).send('スレッドが見つかりません');
    const r = await pool.query('SELECT * FROM responses WHERE thread_id=$1 ORDER BY id', [id]);
    res.render('thread_detail', {
      thread: t.rows[0],
      responses: r.rows,
      success: req.query.success || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('レス取得エラー');
  }
});

app.post('/alert', upload.single('image'), async (req, res) => {
  const { threadId, name, content, delete_password } = req.body;
  let image_filename = null;
  if (req.file) {
    try {
      image_filename = await optimizeImage(req.file.path, req.file.filename);
    } catch (err) {
      console.error('画像圧縮エラー:', err);
      return res.status(500).send('画像の処理に失敗しました');
    }
  }
  if (!content || !threadId || !delete_password)
    return res.status(400).send('不正な入力です');

  res.render('alert', {
    threadId,
    name: name?.trim() || '名無しの学生',
    content: content.trim(),
    delete_password: delete_password.trim(),
    image_filename
  });
});

app.post('/threads/:id/responses', upload.single('image'), async (req, res) => {
  const tid = parseInt(req.params.id,10);
  const name = req.body.name?.trim() || '名無しの学生';
  const content = req.body.content?.trim();
  const delete_password = req.body.delete_password?.trim();
  let image_filename = req.body.image_filename;     // 旧ファイル名（編集時など）
  if (req.file) {
    try {
      image_filename = await optimizeImage(req.file.path, req.file.filename);
    } catch (err) {
      console.error('画像圧縮エラー:', err);
      return res.status(500).send('画像の処理に失敗しました');
    }
  }
  if (!content || !delete_password)
    return res.status(400).send('内容と削除用パスワードは必須です');

  try {
    const now = getJapanTime(), dateStr = now.toISOString().split('T')[0];
    const ip = getClientIp(req), anon = generateAnonId(ip, dateStr);
    await pool.query(
      `INSERT INTO responses (thread_id, text, created_at, name, anon_id, ip_address, delete_password, image_filename)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, content, now, name, anon, ip, delete_password, image_filename]
    );
    res.redirect(`/threads/${tid}/success`);
  } catch (err) {
    console.error(err);
    res.status(500).send('レス保存に失敗しました');
  }
});

app.get('/threads/:id/success', (req, res) =>
  res.render('success', { threadId: req.params.id })
);

app.post('/responses/:id/delete', async (req, res) => {
  const responseId = parseInt(req.params.id,10);
  const inputPassword = req.body.delete_password;
  try {
    const { rows } = await pool.query('SELECT * FROM responses WHERE id=$1', [responseId]);
    if (!rows.length) return res.status(404).send('レスが見つかりません');
    const response = rows[0];
    if (!response.delete_password)
      return res.status(400).send('このレスは削除できません（パスワード未設定）');
    if (inputPassword !== response.delete_password)
      return res.status(403).send('パスワードが違います');

    if (response.image_filename) {
      const imgPath = path.join(__dirname, 'public/uploads', response.image_filename);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    await pool.query('DELETE FROM responses WHERE id=$1', [responseId]);
    res.redirect('back');
  } catch (err) {
    console.error('レス削除エラー:', err);
    res.status(500).send('サーバーエラー');
  }
});

app.post('/threads/:id/delete', async (req, res) => {
  const id = parseInt(req.params.id,10);
  const pw = req.body.deletePassword;
  try {
    const pr = await pool.query('SELECT deletePassword, club_id FROM threads WHERE id=$1', [id]);
    if (!pr.rows.length || pr.rows[0].deletePassword !== pw)
      return res.status(403).send('削除用パスワードが違います');

    await pool.query('DELETE FROM responses WHERE thread_id=$1', [id]);
    await pool.query('DELETE FROM threads WHERE id=$1', [id]);
    res.render('delete_success', {
      message: 'スレッドが正常に削除されました。',
      clubId: pr.rows[0].club_id
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('削除に失敗しました');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
