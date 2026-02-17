const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const database = require('../services/database');
const imageManager = require('../services/image-manager');
const scheduler = require('../services/scheduler');
const diaryScraper = require('../services/diary-scraper');
const gitSync = require('../services/git-sync');

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
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, name);
  }
});
const upload = multer({ storage });

// === 写メ日記 統計 ===

router.get('/stats', (req, res) => {
  const stats = database.getStats();
  const schedulerStatus = scheduler.getStatus();
  res.json({ ...stats, scheduler: schedulerStatus });
});

// === 写メ日記 アカウント管理 ===

const ACCOUNTS_PATH = path.join(__dirname, '../../config/accounts.json');

function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_PATH)) return [];
  return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
}

function saveAccounts(accounts) {
  const dir = path.dirname(ACCOUNTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2), 'utf-8');
  gitSync.push('写メ日記アカウント更新');
}

router.get('/accounts', (req, res) => {
  const accounts = loadAccounts();
  const withStats = accounts.map(a => ({
    ...a,
    loginPassword: a.loginPassword ? '***' : '',
    imageStats: imageManager.getImageStats(a.id)
  }));
  res.json(withStats);
});

router.post('/accounts', (req, res) => {
  const accounts = loadAccounts();
  const name = (req.body.name || '').trim();
  if (accounts.some(a => a.name === name)) {
    return res.status(400).json({ error: `「${name}」は既に登録されています` });
  }
  const newId = `account_${Date.now()}`;
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
    diaryUrl: req.body.diaryUrl || '',
    diaryPageUrl: req.body.diaryPageUrl || '',
    sampleDiaries: req.body.sampleDiaries || '',
    postType: req.body.postType || 'diary',
    visibility: req.body.visibility || 'public'
  };
  accounts.push(account);
  saveAccounts(accounts);
  const dir = imageManager.getAccountDir(newId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  res.json(account);
});

router.put('/accounts/:id', (req, res) => {
  const accounts = loadAccounts();
  const idx = accounts.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '見つかりません' });
  const name = (req.body.name || '').trim();
  if (accounts.some(a => a.name === name && a.id !== req.params.id)) {
    return res.status(400).json({ error: `「${name}」は既に登録されています` });
  }
  if (req.body.loginPassword === '***') {
    req.body.loginPassword = accounts[idx].loginPassword;
  }
  accounts[idx] = { ...accounts[idx], ...req.body };
  saveAccounts(accounts);
  res.json(accounts[idx]);
});

router.delete('/accounts/:id', (req, res) => {
  let accounts = loadAccounts();
  accounts = accounts.filter(a => a.id !== req.params.id);
  saveAccounts(accounts);
  res.json({ success: true });
});

// === 過去日記スクレイプ ===

router.post('/accounts/:accountId/scrape-diary', async (req, res) => {
  try {
    const diaryPageUrl = req.body.diaryPageUrl;
    if (!diaryPageUrl) return res.status(400).json({ error: '日記ページURLが必要です' });
    const entries = await diaryScraper.scrapeAndSave(req.params.accountId, diaryPageUrl);
    res.json({ success: true, entries, count: entries.length });
  } catch (e) {
    console.error('日記スクレイプエラー:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// === 画像管理 ===

router.get('/accounts/:accountId/images', (req, res) => {
  const images = imageManager.getAccountImages(req.params.accountId);
  const stats = imageManager.getImageStats(req.params.accountId);
  res.json({ images, ...stats });
});

router.get('/accounts/:accountId/images/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const filePath = path.join(imageManager.getAccountDir(req.params.accountId), filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).end();
  }
});

router.post('/accounts/:accountId/images', upload.array('images', 20), (req, res) => {
  res.json({
    success: true,
    uploaded: req.files.length,
    images: imageManager.getAccountImages(req.params.accountId)
  });
});

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

// === 写メ日記 投稿実行 ===

router.post('/post/all', async (req, res) => {
  res.json({ message: '投稿を開始しました' });
  scheduler.runOnce().catch(e => console.error('投稿エラー:', e));
});

router.post('/post/:accountId', async (req, res) => {
  const result = await scheduler.runSingle(req.params.accountId);
  res.json(result);
});

// === 写メ日記 スケジューラー ===

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
      const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      if (settings.geminiApiKey) settings.geminiApiKey = '***';
      if (settings.openaiApiKey) settings.openaiApiKey = '***';
      res.json(settings);
    } else {
      res.json({
        minChars: 450, maxChars: 1000,
        postingEnabled: false, schedule: '0 */3 8-23 * * *',
        miteneMaxSends: 10, miteneMinWeeks: 0
      });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', (req, res) => {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let existing = {};
  try {
    if (fs.existsSync(SETTINGS_PATH)) existing = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch (e) { /* 無視 */ }
  if (req.body.geminiApiKey) {
    // 新しいキーが入力された
  } else if (existing.geminiApiKey) {
    req.body.geminiApiKey = existing.geminiApiKey;
  }
  if (req.body.openaiApiKey) {
    // 新しいキーが入力された
  } else if (existing.openaiApiKey) {
    req.body.openaiApiKey = existing.openaiApiKey;
  }
  try {
    const ai = require('../services/ai-generator');
    ai._geminiModels = {};
    ai._openaiClient = null;
  } catch (e) { /* 無視 */ }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(req.body, null, 2), 'utf-8');
  gitSync.push('設定更新');
  res.json(req.body);
});

// === ブラウザテスト ===

router.post('/test/browser', async (req, res) => {
  const poster = require('../services/cityhaven-poster');
  const result = await poster.testBrowser();
  res.json(result);
});

module.exports = router;
