const express = require('express');
const fs = require('fs');
const path = require('path');
const database = require('../services/database');
const miteneScheduler = require('../services/mitene-scheduler');
const gitSync = require('../services/git-sync');

const router = express.Router();

// === ミテネ アカウント管理 ===

const MITENE_ACCOUNTS_PATH = path.join(__dirname, '../../config/mitene-accounts.json');
const SETTINGS_PATH = path.join(__dirname, '../../config/settings.json');

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
router.get('/accounts', (req, res) => {
  const accounts = loadMiteneAccounts();
  const safe = accounts.map(a => ({
    ...a,
    loginPassword: a.loginPassword ? '***' : ''
  }));
  res.json(safe);
});

// ミテネアカウント追加
router.post('/accounts', (req, res) => {
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
router.put('/accounts/:id', (req, res) => {
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
router.delete('/accounts/:id', (req, res) => {
  let accounts = loadMiteneAccounts();
  accounts = accounts.filter(a => a.id !== req.params.id);
  saveMiteneAccounts(accounts);
  res.json({ success: true });
});

// ミテネステータス
router.get('/status', (req, res) => {
  res.json(miteneScheduler.getStatus());
});

// ミテネ投稿履歴
router.get('/posts', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const all = database.getPosts(limit * 2);
  res.json(all.filter(p => p.postType === 'mitene').slice(0, limit));
});

router.get('/posts/today', (req, res) => {
  const all = database.getTodayPosts();
  res.json(all.filter(p => p.postType === 'mitene'));
});

// 全アカウントミテネ送信
router.post('/send/all', async (req, res) => {
  res.json({ message: 'ミテネ送信を開始しました' });
  miteneScheduler.runAll().catch(e => console.error('ミテネエラー:', e));
});

// ミテネスケジューラー
router.post('/scheduler/start', (req, res) => {
  miteneScheduler.start();
  res.json({ success: true, status: miteneScheduler.getStatus() });
});

router.post('/scheduler/stop', (req, res) => {
  miteneScheduler.stop();
  res.json({ success: true, status: miteneScheduler.getStatus() });
});

// 選択した子をランダムな時刻に送信
router.post('/random-send', (req, res) => {
  const { accountIds, from, to } = req.body;
  if (!accountIds || accountIds.length === 0) {
    return res.status(400).json({ error: 'アカウントが選択されていません' });
  }

  const [fromH, fromM] = (from || '10:00').split(':').map(Number);
  const [toH, toM] = (to || '09:00').split(':').map(Number);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), fromH, fromM);
  let todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), toH, toM);

  if (todayEnd <= todayStart) {
    todayEnd.setDate(todayEnd.getDate() + 1);
  }

  const rangeStart = now > todayStart ? now : todayStart;
  const rangeEnd = todayEnd;

  if (rangeStart >= rangeEnd) {
    return res.status(400).json({ error: '指定した時間帯が既に過ぎています' });
  }

  const accounts = loadMiteneAccounts();
  const rangeMs = rangeEnd.getTime() - rangeStart.getTime();

  const BUFFER_MS = 10 * 60 * 1000;
  let diaryTimes = [];
  try {
    const settings = fs.existsSync(SETTINGS_PATH) ? JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) : {};
    const cronExpr = settings.schedule || '0 */3 8-23 * * *';
    const parts = cronExpr.split(' ');
    if (parts.length >= 6) {
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
        const t2 = new Date(t.getTime() + 86400000);
        diaryTimes.push(t2);
      }
    }
  } catch (e) { /* 無視 */ }

  function isConflict(time) {
    return diaryTimes.some(dt => Math.abs(time.getTime() - dt.getTime()) < BUFFER_MS);
  }

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

  scheduled.sort((a, b) => a.sendTime - b.sendTime);

  const today = now.getDate();
  const scheduledTimes = scheduled.map(s => {
    const t = s.sendTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const isNextDay = s.sendTime.getDate() !== today;
    return { name: s.name, time: isNextDay ? `翌${t}` : t };
  });

  console.log('ランダム送信予約:');
  scheduledTimes.forEach(s => {
    console.log(`  ${s.name}: ${s.time}`);
  });

  res.json({ message: 'ランダム送信を予約しました', scheduledTimes });

  scheduled.forEach(s => {
    const delay = s.sendTime.getTime() - Date.now();
    setTimeout(async () => {
      console.log(`ランダム送信開始: ${s.name}`);
      await miteneScheduler.runSingle(s.id).catch(e => console.error('ミテネエラー:', e));
    }, Math.max(delay, 0));
  });
});

// ミテネ設定
router.get('/settings', (req, res) => {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      res.json({
        miteneMaxSends: settings.miteneMaxSends || 10,
        miteneMinWeeks: settings.miteneMinWeeks || 0
      });
    } else {
      res.json({ miteneMaxSends: 10, miteneMinWeeks: 0 });
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
  existing.miteneMaxSends = req.body.miteneMaxSends;
  existing.miteneMinWeeks = req.body.miteneMinWeeks;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(existing, null, 2), 'utf-8');
  gitSync.push('ミテネ設定更新');
  res.json(existing);
});

// 単一アカウントミテネ送信（パラメータルートは最後）
router.post('/send/:accountId', async (req, res) => {
  const result = await miteneScheduler.runSingle(req.params.accountId);
  res.json(result);
});

module.exports = router;
