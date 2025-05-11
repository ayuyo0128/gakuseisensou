const express = require('express');
const router = express.Router();
const db = require('../sqlite');  // SQLiteを使ってデータベースにアクセス

// 部活詳細ページへのルーティング
router.get('/:clubName', (req, res) => {
  const clubName = decodeURIComponent(req.params.clubName);  // URLから部活名を取得

  // 部活に関連するスレッドをデータベースから取得
  db.all(`SELECT * FROM threads WHERE club = ? ORDER BY created_at DESC`, [clubName], (err, threads) => {
    if (err) {
      console.error(err);
      return res.status(500).send('DB Error');  // DBエラーが発生した場合
    }
    
    // スレッド情報をビューに渡して、`club_detail.ejs`を表示
    res.render('club_detail', { clubName, threads });
  });
});

module.exports = router;
