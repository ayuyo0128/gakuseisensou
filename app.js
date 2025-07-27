require('dotenv').config();
require('dns').setDefaultResultOrder('ipv4first');
console.log('DATABASE_URL=', process.env.DATABASE_URL);
console.log('CLOUD_STORAGE_BUCKET=', process.env.CLOUD_STORAGE_BUCKET);

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');

const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  host: `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`,
});


const app = express();

// ─── Multer 設定（メモリストレージ） ───
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const ok = allowedTypes.includes(file.mimetype);
    cb(ok ? null : new Error('画像ファイルのみアップロードできます（動画は不可）'), ok);
  }
});

// ─── GCSクライアント設定 ───
const storage = new Storage();
const bucketName = process.env.CLOUD_STORAGE_BUCKET;
const bucket = storage.bucket(bucketName);

// ─── 画像最適化＋アップロード関数 ───
async function optimizeAndUploadImage(buffer, originalName) {
  try {
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.webp`;
    const optimizedBuffer = await sharp(buffer)
      .resize({ width: 960, withoutEnlargement: true })
      .webp({ quality: 60 })
      .toBuffer();
    const file = bucket.file(filename);
    await file.save(optimizedBuffer, {
      metadata: { contentType: 'image/webp' },
      public: true,
      validation: 'md5'
    });
    return filename;
  } catch (err) {
    console.error('画像最適化エラー:', err);
    throw err;
  }
}

app.set('trust proxy', true);
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '30d' }));
app.set('view engine', 'ejs');

// ユーティリティ関数
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
  const d   = new Date();
  // getTime() はローカル時刻 ms、getTimezoneOffset() は 分 単位の差分
  const utc = d.getTime() + (d.getTimezoneOffset() * 60 * 1000);
  // JST = UTC + 9h
  return new Date( utc + (9 * 60 * 60 * 1000) );
}

// テーブル初期化
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS clubs (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS threads (
      id SERIAL PRIMARY KEY,
      club_id INTEGER REFERENCES clubs(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMP,
      deletepassword TEXT NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS responses (
      id SERIAL PRIMARY KEY,
      thread_id INTEGER REFERENCES threads(id),
      text TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMP,
      anon_id TEXT,
      ip_address TEXT,
      delete_password TEXT,
      image_filename TEXT
    )`);

    const { rows } = await pool.query('SELECT COUNT(*) FROM clubs');
    if (parseInt(rows[0].count, 10) === 0) {
      const initClubs = [
        ['ニート部','ニートの集まり'],['暇部','暇人集合'],['愚痴部','日頃の愚痴を吐き出す場所'],
        ['腐女子部','腐女子による腐女子のための'],['討論部','熱く議論したい人たちへ'],
        ['恋愛部','恋バナしよ'],['勉強部','一緒に勉強しよう'],['おもしろ部','笑いたい人集まれ'],
        ['なんｚ','なんでも実況'],['ｖｉｐ','VIPPERたちのたまり場']
      ];
      for (const [n, d] of initClubs) {
        await pool.query(
          'INSERT INTO clubs (name,description) VALUES ($1,$2)',
          [n, d]
        );
      }
      console.log('初期部活データを挿入しました');
    }
  } catch (err) {
    console.error('テーブル初期化エラー:', err);
  }
})();

// ルーティング
app.get('/clubs/new', (req, res) => res.render('clubs_new'));
app.post('/clubs/new', async (req, res) => {
  const { name, description } = req.body;
  if (!name || !description) return res.status(400).send('部活名と説明は必須です');
  try {
    await pool.query('INSERT INTO clubs (name, description) VALUES ($1, $2)', [name, description]);
    res.redirect('/clubs');
  } catch (err) {
    console.error('部活追加エラー:', err);
    res.status(500).send('部活の追加に失敗しました');
  }
});

app.get('/', (req, res) => res.render('welcome'));

app.get('/clubs', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clubs ORDER BY name');
    res.render('index', { clubs: rows });
  } catch (err) {
    console.error('クラブ一覧取得エラー:', err);
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


app.post('/confirm-thread', upload.single('image'), async (req, res) => {
  const { title, description, clubId, deletepassword } = req.body;
  let image_filename = null;
  if (req.file) {
    try {
      image_filename = await optimizeAndUploadImage(req.file.buffer, req.file.originalname);
    } catch (err) {
      console.error('画像アップロードエラー:', err);
      return res.status(500).send('画像の処理に失敗しました');
    }
  }
  res.render('alert_thread', { title, description, clubId, deletepassword, image_filename });
});

app.get('/clubs/:club_id/threads/new', async (req, res) => {
  const clubId = parseInt(req.params.club_id, 10);
  try {
    const { rows } = await pool.query('SELECT * FROM clubs WHERE id=$1', [clubId]);
    if (!rows.length) return res.status(404).send('部活が見つかりません');
    // error を null で初期化してテンプレートに渡す
    res.render('create_thread', { club: rows[0], error: null });
  } catch (err) {
    console.error(err);
    res.status(500).send('サーバーエラー');
  }
});

app.post('/clubs/:club_id/threads', upload.single('image'), async (req, res) => {
  const clubId = parseInt(req.params.club_id, 10);
  const { title, description, deletepassword } = req.body;

  if (!title || !description || !deletepassword)
    return res.status(400).send('タイトル・内容・削除用パスワードは必須です');

  try {
    const now = getJapanTime();
    const dateStr = now.toISOString().split('T')[0];
    const ip = getClientIp(req);
    const anon = generateAnonId(ip, dateStr);

    // 画像処理
    let imageFilename = null;
    if (req.file) {
      imageFilename = await optimizeAndUploadImage(req.file.buffer, req.file.originalname);
      console.log('新スレ投稿時の画像ファイル名:', imageFilename);
    }

    // スレッド作成
    const ins = await pool.query(
      `INSERT INTO threads (club_id,title,description,created_at,deletepassword)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [clubId, title, description, now, deletepassword]
    );
    const threadId = ins.rows[0].id;

    // 最初のレス（スレ主）作成（ここに画像ファイルも含める！）
    await pool.query(
      `INSERT INTO responses (thread_id,text,created_at,name,anon_id,ip_address,delete_password,image_filename)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [threadId, description, now, '名無しの学生', anon, ip, deletepassword, imageFilename]
    );

    res.redirect(`/success-thread?threadId=${threadId}&clubId=${clubId}`);
  } catch (err) {
    console.error('スレッド作成エラー:', err);
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
    res.render('thread_detail', { thread: t.rows[0], responses: r.rows, success: req.query.success || null, bucketName: bucketName });
  } catch (err) {
    console.error(err);
    res.status(500).send('レス取得エラー');
  }
});

app.post('/responses/confirm', upload.single('image'), async (req, res) => {
  const { threadId, name, content, delete_password } = req.body;
  let image_filename = null;

  if (req.file) {
    image_filename = await optimizeAndUploadImage(req.file.buffer, req.file.originalname);
  }

  res.render('alert', {
    threadId,
    name: name || '名無しの学生',
    content,
    delete_password,
    image_filename
  });
});
app.post('/responses/post', async (req, res) => {
  const now = getJapanTime(); // JST に修正
  const dateStr = now.toISOString().split('T')[0];
  const ip = getClientIp(req);
  const anon = generateAnonId(ip, dateStr);
  const { threadId, name, content, delete_password, image_filename } = req.body;

  await pool.query(
    `INSERT INTO responses 
     (thread_id, text, created_at, name, anon_id, ip_address, delete_password, image_filename)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [threadId, content, now, name, anon, ip, delete_password, image_filename]
  );

  res.redirect(`/threads/${threadId}/success`);
});

app.get('/threads/:id/success', (req, res) => res.render('success', { threadId: req.params.id }));
// スレッド検索（キーワードをもとにthreadsのtitleやdescriptionを検索）
app.get('/search', async (req, res) => {
  const keyword = req.query.keyword || '';
  if (!keyword) {
    return res.render('search_results', { threads: [], keyword });
  }

  try {
    const q = `
      SELECT threads.*, clubs.name AS club_name
      FROM threads
      JOIN clubs ON threads.club_id = clubs.id
      WHERE threads.title ILIKE $1 OR threads.description ILIKE $1
      ORDER BY threads.created_at DESC
      LIMIT 50
    `;
    const { rows } = await pool.query(q, [`%${keyword}%`]);
    res.render('search_results', { threads: rows, keyword });
  } catch (err) {
    console.error('検索エラー:', err);
    res.status(500).send('検索に失敗しました');
  }
});

app.post('/responses/:id/delete', async (req, res) => {
  const responseId = parseInt(req.params.id,10);
  const inputPassword = req.body.delete_password;
  try {
    const { rows } = await pool.query('SELECT * FROM responses WHERE id=$1', [responseId]);
    if (!rows.length) return res.status(404).send('レスが見つかりません');
    const response = rows[0];
    if (!response.delete_password) return res.status(400).send('このレスは削除できません（パスワード未設定）');
    if (inputPassword !== response.delete_password) return res.status(403).send('パスワードが違います');
    await pool.query('DELETE FROM responses WHERE id=$1', [responseId]);
    res.redirect('back');
  } catch (err) {
    console.error('レス削除エラー:', err);
    res.status(500).send('サーバーエラー');
  }
});

app.post('/threads/:id/delete', async (req, res) => {
  const id = parseInt(req.params.id,10);
  const pw = req.body.deletepassword?.trim();
  if (!pw) return res.status(403).send('削除用パスワードが未入力です');
  try {
    const result = await pool.query('SELECT deletepassword AS password, club_id FROM threads WHERE id=$1', [id]);
    if (!result.rows.length) return res.status(404).send('スレッドが見つかりません'); 
    const { password, club_id } = result.rows[0];
    if (password.trim() !== pw) return res.status(403).send('削除用パスワードが違います');
    await pool.query('DELETE FROM responses WHERE thread_id = $1', [id]);
    await pool.query('DELETE FROM threads WHERE id = $1', [id]);
    res.render('delete_success', { message: 'スレッドが正常に削除されました。', clubId: club_id });
  } catch (err) {
    console.error('スレッド削除エラー:', err);
    res.status(500).send('削除に失敗しました');
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});