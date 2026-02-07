require('dotenv').config();
const express = require('express');
const path = require('path');
const apiRoutes = require('./src/routes/api');

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

app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  HEAVEN - 自動日記投稿システム');
  console.log('═══════════════════════════════════════════');
  console.log(`  ダッシュボード: http://localhost:${PORT}`);
  console.log('  API:            http://localhost:' + PORT + '/api');
  console.log('═══════════════════════════════════════════');
  console.log('');
});
