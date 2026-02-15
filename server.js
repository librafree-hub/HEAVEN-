require('dotenv').config();
const express = require('express');
const path = require('path');
const apiRoutes = require('./src/routes/api');
const gitSync = require('./src/services/git-sync');

const app = express();
const PORT = process.env.PORT || 3000;

// ミドルウェア
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静的ファイル（ダッシュボード）
app.use(express.static(path.join(__dirname, 'public')));

// API
app.use('/api', apiRoutes);

// ダッシュボードのフォールバック
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 起動時に最新データを取得してからサーバー開始
gitSync.pull().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  HEAVEN - 自動日記投稿システム');
    console.log('═══════════════════════════════════════════');
    console.log(`  ダッシュボード: http://localhost:${PORT}`);
    console.log('═══════════════════════════════════════════');
    console.log('');

    // サーバー起動後にブラウザを自動で開く
    const { exec } = require('child_process');
    const url = `http://localhost:${PORT}`;
    if (process.platform === 'win32') {
      exec(`start ${url}`);
    } else if (process.platform === 'darwin') {
      exec(`open ${url}`);
    } else {
      exec(`xdg-open ${url}`).on('error', () => {});
    }
  });
});
