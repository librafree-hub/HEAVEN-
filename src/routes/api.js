const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const database = require('../services/database');
const imageManager = require('../services/image-manager');
const scheduler = require('../services/scheduler');
const miteneScheduler = require('../services/mitene-scheduler');
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

// ==========================================
// === ミテネ（完全に別管理）===
// ==========================================

const MITENE_ACCOUNTS_PATH = path.join(__dirname, '../../config/mitene-accounts.json');

function loadMiteneAccounts() {
  if (!fs.existsSync(MITENE_ACCOUNTS_PATH)) return [];
  return JSON.parse(fs.readFileSync(MITENE_ACCOUNTS_PATH, 'utf-8'));
}

function saveMiteneAccounts(accounts) {
  const dir = path.dirname(MITENE_ACCOUNTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MITENE_ACCOUNTS_PATH, JSON.stringify(accounts, null, 2), 'utf-8');
  gitSync.push('ミテネアカウント更新');
}

// ミテネアカウント一覧
router.get('/mitene-accounts', (req, res) => {
  const accounts = loadMiteneAccounts();
  const safe = accounts.map(a => ({
    ...a,
    loginPassword: a.loginPassword ? '***' : ''
  }));
  res.json(safe);
});

// ミテネアカウント追加
router.post('/mitene-accounts', (req, res) => {
  const accounts = loadMiteneAccounts();
  const name = (req.body.name || '').trim();
  if (accounts.some(a => a.name === name)) {
    return res.status(400).json({ error: `「${name}」は既に登録されています` });
  }
  const newId = `mitene_${Date.now()}`;
  const account = {
    id: newId,
    name: req.body.name || '新規',
    loginUrl: req.body.loginUrl || '',
    loginId: req.body.loginId || '',
    loginPassword: req.body.loginPassword || '',
    schedule: req.body.schedule || '10:00',
    active: true
  };
  accounts.push(account);
  saveMiteneAccounts(accounts);
  res.json(account);
});

// ミテネアカウント更新
router.put('/mitene-accounts/:id', (req, res) => {
  const accounts = loadMiteneAccounts();
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
  saveMiteneAccounts(accounts);
  res.json(accounts[idx]);
});

// ミテネアカウント削除
router.delete('/mitene-accounts/:id', (req, res) => {
  let accounts = loadMiteneAccounts();
  accounts = accounts.filter(a => a.id !== req.params.id);
  saveMiteneAccounts(accounts);
  res.json({ success: true });
});

// ミテネステータス
router.get('/mitene/status', (req, res) => {
  res.json(miteneScheduler.getStatus());
});

// 全アカウントミテネ送信
router.post('/mitene/all', async (req, res) => {
  res.json({ message: 'ミテネ送信を開始しました' });
  miteneScheduler.runAll().catch(e => console.error('ミテネエラー:', e));
});

// ミテネスケジューラー
router.post('/mitene/scheduler/start', (req, res) => {
  miteneScheduler.start();
  res.json({ success: true, status: miteneScheduler.getStatus() });
});

router.post('/mitene/scheduler/stop', (req, res) => {
  miteneScheduler.stop();
  res.json({ success: true, status: miteneScheduler.getStatus() });
});

// 選択した子をランダムな時刻に送信
router.post('/mitene/random-send', (req, res) => {
  const { accountIds, from, to } = req.body;
  if (!accountIds || accountIds.length === 0) {
    return res.status(400).json({ error: 'アカウントが選択されていません' });
  }

  // 時間帯をパース（日またぎ対応）
  const [fromH, fromM] = (from || '10:00').split(':').map(Number);
  const [toH, toM] = (to || '09:00').split(':').map(Number);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), fromH, fromM);
  let todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), toH, toM);

  // 終了が開始より前なら翌日扱い（例: 10:00〜翌9:00）
  if (todayEnd <= todayStart) {
    todayEnd.setDate(todayEnd.getDate() + 1);
  }

  // 現在時刻が開始時刻より前なら開始時刻から、過ぎていたら現在時刻から
  const rangeStart = now > todayStart ? now : todayStart;
  const rangeEnd = todayEnd;

  if (rangeStart >= rangeEnd) {
    return res.status(400).json({ error: '指定した時間帯が既に過ぎています' });
  }

  // アカウント情報を取得
  const accounts = loadMiteneAccounts();
  const rangeMs = rangeEnd.getTime() - rangeStart.getTime();

  // 日記投稿のスケジュール時刻を取得して重複回避（±10分）
  const BUFFER_MS = 10 * 60 * 1000; // 10分
  let diaryTimes = [];
  try {
    const settings = fs.existsSync(SETTINGS_PATH) ? JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) : {};
    const cronExpr = settings.schedule || '0 */3 8-23 * * *';
    // cronから次24時間の日記投稿時刻を計算
    const parts = cronExpr.split(' ');
    if (parts.length >= 6) {
      const cronMin = parts[1] === '0' ? [0] : [0];
      const cronHourPart = parts[2];
      const hourRange = parts[3] || '*';
      let hours = [];
      if (cronHourPart.startsWith('*/')) {
        const step = parseInt(cronHourPart.substring(2));
        const [hStart, hEnd] = hourRange.includes('-') ? hourRange.split('-').map(Number) : [0, 23];
        for (let h = hStart; h <= hEnd; h += step) hours.push(h);
      }
      const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      for (const h of hours) {
        const t = new Date(baseDate.getTime() + h * 3600000);
        diaryTimes.push(t);
        // 翌日分も追加
        const t2 = new Date(t.getTime() + 86400000);
        diaryTimes.push(t2);
      }
    }
  } catch (e) { /* 無視 */ }

  // ランダム時刻を生成（日記時刻と±10分被らないようにする）
  function isConflict(time) {
    return diaryTimes.some(dt => Math.abs(time.getTime() - dt.getTime()) < BUFFER_MS);
  }

  // 各アカウントにランダムな時刻を割り当て
  const scheduled = accountIds.map(id => {
    const acc = accounts.find(a => a.id === id);
    let sendTime;
    let attempts = 0;
    do {
      const randomMs = Math.floor(Math.random() * rangeMs);
      sendTime = new Date(rangeStart.getTime() + randomMs);
      attempts++;
    } while (isConflict(sendTime) && attempts < 50);
    return { id, name: acc ? acc.name : id, sendTime };
  });

  // 時刻順にソート
  scheduled.sort((a, b) => a.sendTime - b.sendTime);

  const today = now.getDate();
  const scheduledTimes = scheduled.map(s => {
    const t = s.sendTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const isNextDay = s.sendTime.getDate() !== today;
    return { name: s.name, time: isNextDay ? `翌${t}` : t };
  });

  console.log('🎲 ランダム送信予約:');
  scheduledTimes.forEach(s => {
    console.log(`  ${s.name}: ${s.time}`);
  });

  res.json({ message: 'ランダム送信を予約しました', scheduledTimes });

  // 各時刻にsetTimeoutで予約
  scheduled.forEach(s => {
    const delay = s.sendTime.getTime() - Date.now();
    setTimeout(async () => {
      console.log(`🎲 ランダム送信開始: ${s.name}`);
      await miteneScheduler.runSingle(s.id).catch(e => console.error('ミテネエラー:', e));
    }, Math.max(delay, 0));
  });
});

// 単一アカウントミテネ送信（パラメータルートは最後）
router.post('/mitene/send/:accountId', async (req, res) => {
  const result = await miteneScheduler.runSingle(req.params.accountId);
  res.json(result);
});

// === 設定 ===

const SETTINGS_PATH = path.join(__dirname, '../../config/settings.json');

router.get('/settings', (req, res) => {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      // APIキーはマスクして返す（フロントにそのまま返さない）
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
  // 既存設定を読み込み
  let existing = {};
  try {
    if (fs.existsSync(SETTINGS_PATH)) existing = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch (e) { /* 無視 */ }
  // Gemini APIキー: 送られてきた場合のみ更新、なければ既存を保持
  if (req.body.geminiApiKey) {
    // 新しいキーが入力された
  } else if (existing.geminiApiKey) {
    req.body.geminiApiKey = existing.geminiApiKey;
  }
  // OpenAI APIキー: 同様
  if (req.body.openaiApiKey) {
    // 新しいキーが入力された
  } else if (existing.openaiApiKey) {
    req.body.openaiApiKey = existing.openaiApiKey;
  }
  // AIモデルキャッシュをリセット
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
