const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const database = require('../services/database');
const imageManager = require('../services/image-manager');
const scheduler = require('../services/scheduler');

const router = express.Router();

// 画像アップロード設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const accountId = req.params.accountId;
    const dir = imageManager.getAccountDir(accountId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // 元のファイル名をUTF-8で保持
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, name);
  }
});
const upload = multer({ storage });

// === ダッシュボード ===

// 全体統計
router.get('/stats', (req, res) => {
  const stats = database.getStats();
  const schedulerStatus = scheduler.getStatus();
  res.json({ ...stats, scheduler: schedulerStatus });
});

// === アカウント管理 ===

const ACCOUNTS_PATH = path.join(__dirname, '../../config/accounts.json');

function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_PATH)) return [];
  return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
}

function saveAccounts(accounts) {
  const dir = path.dirname(ACCOUNTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2), 'utf-8');
}

// アカウント一覧
router.get('/accounts', (req, res) => {
  const accounts = loadAccounts();
  const withStats = accounts.map(a => ({
    ...a,
    loginPassword: a.loginPassword ? '***' : '',
    imageStats: imageManager.getImageStats(a.id)
  }));
  res.json(withStats);
});

// アカウント追加
router.post('/accounts', (req, res) => {
  const accounts = loadAccounts();
  const newId = `account_${accounts.length + 1}`;
  const account = {
    id: newId,
    name: req.body.name || '新規',
    personality: req.body.personality || '',
    tone: req.body.tone || '',
    interests: req.body.interests || [],
    writingStyle: req.body.writingStyle || '',
    postsPerDay: req.body.postsPerDay || 3,
    active: true,
    loginUrl: req.body.loginUrl || '',
    loginId: req.body.loginId || '',
    loginPassword: req.body.loginPassword || '',
    diaryUrl: req.body.diaryUrl || ''
  };
  accounts.push(account);
  saveAccounts(accounts);

  // 画像フォルダも作成
  const dir = imageManager.getAccountDir(newId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  res.json(account);
});

// アカウント更新
router.put('/accounts/:id', (req, res) => {
  const accounts = loadAccounts();
  const idx = accounts.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '見つかりません' });

  // パスワードが***の場合は元の値を保持
  if (req.body.loginPassword === '***') {
    req.body.loginPassword = accounts[idx].loginPassword;
  }

  accounts[idx] = { ...accounts[idx], ...req.body };
  saveAccounts(accounts);
  res.json(accounts[idx]);
});

// アカウント削除
router.delete('/accounts/:id', (req, res) => {
  let accounts = loadAccounts();
  accounts = accounts.filter(a => a.id !== req.params.id);
  saveAccounts(accounts);
  res.json({ success: true });
});

// === 画像管理 ===

// アカウントの画像一覧
router.get('/accounts/:accountId/images', (req, res) => {
  const images = imageManager.getAccountImages(req.params.accountId);
  const stats = imageManager.getImageStats(req.params.accountId);
  res.json({ images, ...stats });
});

// 画像アップロード
router.post('/accounts/:accountId/images', upload.array('images', 20), (req, res) => {
  res.json({
    success: true,
    uploaded: req.files.length,
    images: imageManager.getAccountImages(req.params.accountId)
  });
});

// 画像削除
router.delete('/accounts/:accountId/images/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const deleted = imageManager.deleteImage(req.params.accountId, filename);
  if (deleted) {
    res.json({ success: true, images: imageManager.getAccountImages(req.params.accountId) });
  } else {
    res.status(404).json({ error: '画像が見つかりません' });
  }
});

// === 投稿履歴 ===

router.get('/posts', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(database.getPosts(limit));
});

router.get('/posts/today', (req, res) => {
  res.json(database.getTodayPosts());
});

// === 投稿実行 ===

// 全アカウント投稿
router.post('/post/all', async (req, res) => {
  res.json({ message: '投稿を開始しました' });
  // バックグラウンドで実行
  scheduler.runOnce().catch(e => console.error('投稿エラー:', e));
});

// 単一アカウント投稿
router.post('/post/:accountId', async (req, res) => {
  const result = await scheduler.runSingle(req.params.accountId);
  res.json(result);
});

// === スケジューラー ===

router.post('/scheduler/start', (req, res) => {
  scheduler.start();
  res.json({ success: true, status: scheduler.getStatus() });
});

router.post('/scheduler/stop', (req, res) => {
  scheduler.stop();
  res.json({ success: true, status: scheduler.getStatus() });
});

router.get('/scheduler/status', (req, res) => {
  res.json(scheduler.getStatus());
});

// === 設定 ===

const SETTINGS_PATH = path.join(__dirname, '../../config/settings.json');

router.get('/settings', (req, res) => {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      res.json(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')));
    } else {
      res.json({
        minChars: 450,
        maxChars: 1000,
        postingEnabled: false,
        schedule: '0 */3 8-23 * * *'
      });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', (req, res) => {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(req.body, null, 2), 'utf-8');
  res.json(req.body);
});

// === ブラウザテスト ===

router.post('/test/browser', async (req, res) => {
  const poster = require('../services/cityhaven-poster');
  const result = await poster.testBrowser();
  res.json(result);
});

module.exports = router;
