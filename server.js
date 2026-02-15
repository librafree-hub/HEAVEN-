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

// ポート競合を解決してからサーバー起動
function startServer() {
  const server = app.listen(PORT, () => {
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

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️ ポート ${PORT} が使用中です。既存プロセスを停止して再起動します...`);
      const { exec } = require('child_process');
      if (process.platform === 'win32') {
        // Windowsでポートを使っているプロセスを終了
        exec(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /f /pid %a`, { shell: 'cmd.exe' }, (killErr) => {
          if (killErr) {
            console.error(`❌ ポート ${PORT} の解放に失敗しました。前のサーバーを手動で閉じてください。`);
            process.exit(1);
          }
          console.log(`✅ 既存プロセスを停止しました。再起動中...`);
          setTimeout(() => startServer(), 2000);
        });
      } else {
        exec(`lsof -ti:${PORT} | xargs kill -9`, (killErr) => {
          setTimeout(() => startServer(), 2000);
        });
      }
    } else {
      console.error('❌ サーバー起動エラー:', err.message);
      process.exit(1);
    }
  });
}

// 起動時に最新データを取得してからサーバー開始
gitSync.pull().then(() => {
  startServer();
});
