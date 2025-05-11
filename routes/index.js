// 必要なモジュールをインポート
const express = require('express');
const sqlite3 = require('sqlite3');
const path = require('path');
const app = express();

// SQLite3データベースの接続
const db = new sqlite3.Database('./database.db'); // データベースのパスを適切に設定

// EJSの設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// クラブ詳細ページのルート
app.get('/clubs/:clubName', (req, res) => {
  const clubName = req.params.clubName;  // URLパラメータからクラブ名を取得

  // クラブ情報をデータベースから取得
  db.get('SELECT * FROM clubs WHERE name = ?', [clubName], (err, club) => {
    if (err) {
      console.error('データベースエラー:', err);
      return res.status(500).send('データベースの取得に失敗しました');
    }

    if (!club) {
      return res.status(404).send('指定されたクラブは見つかりません');
    }

    // スレッド情報をデータベースから取得
    db.all('SELECT * FROM threads WHERE club_name = ?', [clubName], (err, threads) => {
      if (err) {
        console.error('スレッド取得エラー:', err);
        return res.status(500).send('スレッド情報の取得に失敗しました');
      }

      // クラブ情報とスレッド情報をビューに渡す
      res.render('club_detail', { clubName: clubName, club: club, threads: threads });
    });
  });
});

// サーバー起動
app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});
