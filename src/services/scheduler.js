const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const database = require('./database');
const imageManager = require('./image-manager');
const aiGenerator = require('./ai-generator');
const poster = require('./cityhaven-poster');

const STATE_FILE = path.join(__dirname, '../../data/scheduler-state.json');

class Scheduler {
  constructor() {
    this.jobs = [];
    this.running = false;
    this.status = { lastRun: null, nextRun: null, isRunning: false };
  }

  // 状態をファイルに保存
  _saveState(running) {
    try {
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({ running }, null, 2));
    } catch (e) { /* 無視 */ }
  }

  // 起動時に前回の状態を復元
  restore() {
    try {
      if (!fs.existsSync(STATE_FILE)) return;
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      if (state.running) {
        console.log(`📅 前回のスケジューラー状態を復元中...`);
        this.start();
      }
    } catch (e) { /* 無視 */ }
  }

  _loadAccounts() {
    const accountsPath = path.join(__dirname, '../../config/accounts.json');
    if (!fs.existsSync(accountsPath)) return [];
    return JSON.parse(fs.readFileSync(accountsPath, 'utf-8'))
      .filter(a => a.active);
  }

  _loadSettings() {
    const settingsPath = path.join(__dirname, '../../config/settings.json');
    if (!fs.existsSync(settingsPath)) return {};
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  }

  async postForAccount(account, options = {}) {
    const timestamp = new Date().toLocaleTimeString('ja-JP');
    console.log(`\n⏰ [${timestamp}] 投稿処理開始: ${account.name}`);

    try {
      console.log(`  📸 画像選択中...`);
      const image = imageManager.selectImage(account.id);
      if (!image) {
        throw new Error(`画像がありません: data/images/${account.id}/ にJPG/PNGを配置してください`);
      }
      console.log(`  選択画像: ${image.name}`);

      console.log(`  🤖 AI日記生成中...`);
      const diary = await aiGenerator.generateDiary(account, image.path, options.category);
      console.log(`  生成完了: ${diary.charCount}文字 | タイトル: ${diary.title}`);

      const settings = this._loadSettings();
      if (settings.postingEnabled === false) {
        console.log(`  ⏸️ 投稿無効（テストモード）- 生成のみ完了`);
        database.addPost({
          accountId: account.id,
          accountName: account.name,
          title: diary.title,
          body: diary.body,
          charCount: diary.charCount,
          image: image.name,
          status: 'test',
          message: 'テストモード - 投稿スキップ'
        });
        return { success: true, mode: 'test', diary };
      }

      const postOptions = {};
      const postTypeSetting = account.postType || settings.postType || 'diary';
      postOptions.postType = postTypeSetting === 'random'
        ? (Math.random() < 0.5 ? 'diary' : 'freepost')
        : postTypeSetting;

      const visibilitySetting = account.visibility || settings.visibility || 'public';
      postOptions.visibility = visibilitySetting === 'random'
        ? (Math.random() < 0.5 ? 'public' : 'mygirl')
        : visibilitySetting;

      console.log(`  📤 シティヘブンに投稿中... [${postOptions.postType === 'freepost' ? 'フリーポスト' : '写メ日記'} / ${postOptions.visibility === 'mygirl' ? 'マイガール' : '全公開'}]`);
      const result = await poster.post(account, diary, image.path, postOptions);

      database.addPost({
        accountId: account.id,
        accountName: account.name,
        title: diary.title,
        body: diary.body,
        charCount: diary.charCount,
        image: image.name,
        postType: postOptions.postType,
        visibility: postOptions.visibility,
        status: result.success ? 'success' : 'failed',
        message: result.error || ''
      });

      console.log(result.success
        ? `  ✅ ${account.name}: 投稿成功`
        : `  ❌ ${account.name}: 投稿失敗 - ${result.error}`);
      return result;
    } catch (e) {
      console.error(`  ❌ ${account.name}: エラー - ${e.message}`);
      database.addPost({
        accountId: account.id, accountName: account.name,
        title: '', body: '', charCount: 0, image: '',
        status: 'failed', message: e.message
      });
      return { success: false, error: e.message };
    }
  }

  async runOnce() {
    if (this.status.isRunning) return { error: '既に実行中です' };
    this.status.isRunning = true;
    this.status.lastRun = new Date().toISOString();
    const accounts = this._loadAccounts();
    const results = [];

    console.log(`\n🚀 投稿開始: ${accounts.length}アカウント`);
    for (const account of accounts) {
      const todayPosts = database.getTodayPosts()
        .filter(p => p.accountId === account.id && p.status === 'success');
      if (todayPosts.length >= (account.postsPerDay || 3)) {
        console.log(`  ⏭️ ${account.name}: 今日の投稿上限到達（${todayPosts.length}件）`);
        continue;
      }
      const result = await this.postForAccount(account);
      results.push({ account: account.name, ...result });
      if (accounts.indexOf(account) < accounts.length - 1) {
        const waitMin = 2 + Math.random() * 3;
        console.log(`  ⏳ 次のアカウントまで${waitMin.toFixed(1)}分待機...`);
        await new Promise(r => setTimeout(r, waitMin * 60 * 1000));
      }
    }
    this.status.isRunning = false;
    console.log(`\n✅ 全投稿完了`);
    return { results };
  }

  async runSingle(accountId, options = {}) {
    const accounts = this._loadAccounts();
    const account = accounts.find(a => a.id === accountId);
    if (!account) return { error: `アカウントが見つかりません: ${accountId}` };
    return this.postForAccount(account, options);
  }

  start() {
    const settings = this._loadSettings();
    const cronExpression = settings.schedule || '0 */3 8-23 * * *';
    this.stop();
    this.cronExpression = cronExpression;
    const job = cron.schedule(cronExpression, async () => {
      console.log(`\n⏰ スケジュール実行: ${new Date().toLocaleString('ja-JP')}`);
      await this.runOnce();
    });
    this.jobs.push(job);
    this.running = true;
    this._saveState(true);
    console.log(`📅 スケジューラー開始: ${cronExpression}`);
  }

  stop() {
    for (const job of this.jobs) job.stop();
    this.jobs = [];
    this.running = false;
    this.cronExpression = null;
    this._saveState(false);
  }

  // cron式から次回実行時刻のリストを計算
  _getNextRuns(count = 5) {
    if (!this.cronExpression || !this.running) return [];
    try {
      const interval = cron.getTasks();
      // node-cronには次回実行取得がないので、手動で計算
      const expr = this.cronExpression;
      const parts = expr.split(' ');
      const now = new Date();
      const runs = [];

      // 簡易的にcron式をパース（秒 分 時 日 月 曜）
      const sec = parts[0] || '0';
      const min = parts[1] || '*';
      const hourPart = parts[2] || '*';

      // 時間の範囲を解析
      let hours = [];
      if (hourPart.includes('/')) {
        // */3 8-23 のようなパターン
        const [range, step] = hourPart.split('/');
        const s = parseInt(step);
        let start = 0, end = 23;
        if (range.includes('-')) {
          [start, end] = range.split('-').map(Number);
        }
        for (let h = start; h <= end; h += s) hours.push(h);
      } else if (hourPart.includes('-')) {
        const [start, end] = hourPart.split('-').map(Number);
        for (let h = start; h <= end; h++) hours.push(h);
      } else if (hourPart === '*') {
        for (let h = 0; h <= 23; h++) hours.push(h);
      } else {
        hours = hourPart.split(',').map(Number);
      }

      const minute = min === '0' ? 0 : (min === '*' ? 0 : parseInt(min));

      // 今日と明日の実行予定を生成
      for (let dayOffset = 0; dayOffset <= 1 && runs.length < count; dayOffset++) {
        for (const h of hours) {
          const d = new Date(now);
          d.setDate(d.getDate() + dayOffset);
          d.setHours(h, minute, 0, 0);
          if (d > now) {
            runs.push(d.toISOString());
            if (runs.length >= count) break;
          }
        }
      }
      return runs;
    } catch (e) {
      return [];
    }
  }

  getStatus() {
    return {
      running: this.running,
      schedule: this.cronExpression || null,
      nextRuns: this._getNextRuns(5),
      ...this.status
    };
  }
}

module.exports = new Scheduler();
