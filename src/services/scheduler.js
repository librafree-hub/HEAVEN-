const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const database = require('./database');
const imageManager = require('./image-manager');
const aiGenerator = require('./ai-generator');
const poster = require('./cityhaven-poster');

class Scheduler {
  constructor() {
    this.job = null;
    this.running = false;
    this.status = { lastRun: null, nextRun: null, isRunning: false };
    this._postedThisMinute = new Set(); // 同じ分に重複投稿しない
  }

  // アカウント設定を読み込む
  _loadAccounts() {
    const accountsPath = path.join(__dirname, '../../config/accounts.json');
    if (!fs.existsSync(accountsPath)) return [];
    return JSON.parse(fs.readFileSync(accountsPath, 'utf-8'))
      .filter(a => a.active);
  }

  // 設定を読み込む
  _loadSettings() {
    const settingsPath = path.join(__dirname, '../../config/settings.json');
    if (!fs.existsSync(settingsPath)) return {};
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  }

  // 現在時刻(HH:MM)が投稿時刻リストに含まれるか
  _shouldPostNow(account) {
    const times = account.scheduleTimes;
    if (!times || times.length === 0) return false;

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(Math.floor(now.getMinutes() / 10) * 10).padStart(2, '0');
    const currentTime = `${hh}:${mm}`;

    return times.includes(currentTime);
  }

  // 1アカウント分の投稿処理
  async postForAccount(account) {
    const timestamp = new Date().toLocaleTimeString('ja-JP');
    console.log(`\n⏰ [${timestamp}] 投稿処理開始: ${account.name}`);

    try {
      // 画像選択
      console.log(`  📸 画像選択中...`);
      const image = imageManager.selectImage(account.id);
      if (!image) {
        throw new Error(`画像がありません: data/images/${account.id}/ にJPG/PNGを配置してください`);
      }
      console.log(`  選択画像: ${image.name}`);

      // AI日記生成
      console.log(`  🤖 AI日記生成中...`);
      const diary = await aiGenerator.generateDiary(account, image.path);
      console.log(`  生成完了: ${diary.charCount}文字 | タイトル: ${diary.title}`);

      // シティヘブンに投稿
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

      // 投稿オプション決定
      const postOptions = {};

      const postTypeSetting = account.postType || settings.postType || 'diary';
      if (postTypeSetting === 'random') {
        postOptions.postType = Math.random() < 0.5 ? 'diary' : 'freepost';
      } else {
        postOptions.postType = postTypeSetting;
      }

      const visibilitySetting = account.visibility || settings.visibility || 'public';
      if (visibilitySetting === 'random') {
        postOptions.visibility = Math.random() < 0.5 ? 'public' : 'mygirl';
      } else {
        postOptions.visibility = visibilitySetting;
      }

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

      if (result.success) {
        console.log(`  ✅ ${account.name}: 投稿成功`);
      } else {
        console.log(`  ❌ ${account.name}: 投稿失敗 - ${result.error}`);
      }

      return result;
    } catch (e) {
      console.error(`  ❌ ${account.name}: エラー - ${e.message}`);
      database.addPost({
        accountId: account.id,
        accountName: account.name,
        title: '',
        body: '',
        charCount: 0,
        image: '',
        status: 'failed',
        message: e.message
      });
      return { success: false, error: e.message };
    }
  }

  // 全アカウント投稿（1回実行 - 手動用）
  async runOnce() {
    if (this.status.isRunning) {
      return { error: '既に実行中です' };
    }

    this.status.isRunning = true;
    this.status.lastRun = new Date().toISOString();
    const accounts = this._loadAccounts();
    const results = [];

    console.log(`\n🚀 手動投稿開始: ${accounts.length}アカウント`);

    for (const account of accounts) {
      const todayPosts = database.getTodayPosts()
        .filter(p => p.accountId === account.id && p.status === 'success');

      const maxPosts = (account.scheduleTimes && account.scheduleTimes.length > 0)
        ? account.scheduleTimes.length
        : (account.postsPerDay || 3);

      if (todayPosts.length >= maxPosts) {
        console.log(`  ⏭️ ${account.name}: 今日の投稿上限到達（${todayPosts.length}/${maxPosts}件）`);
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

  // スケジュールチェック（毎分実行）
  async _checkSchedule() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(Math.floor(now.getMinutes() / 10) * 10).padStart(2, '0');
    const timeKey = `${hh}:${mm}`;

    // 10分区切りの先頭でリセット
    if (now.getMinutes() % 10 === 0) {
      this._postedThisMinute = new Set();
    }

    const accounts = this._loadAccounts();

    for (const account of accounts) {
      if (!this._shouldPostNow(account)) continue;

      const postKey = `${account.id}_${timeKey}`;
      if (this._postedThisMinute.has(postKey)) continue;

      // 今日の投稿数チェック
      const todayPosts = database.getTodayPosts()
        .filter(p => p.accountId === account.id && p.status === 'success');
      const maxPosts = account.scheduleTimes ? account.scheduleTimes.length : (account.postsPerDay || 3);
      if (todayPosts.length >= maxPosts) continue;

      this._postedThisMinute.add(postKey);

      console.log(`\n⏰ スケジュール投稿: ${account.name} (${timeKey})`);
      this.status.isRunning = true;
      this.status.lastRun = new Date().toISOString();

      await this.postForAccount(account);

      this.status.isRunning = false;

      // 複数アカウントが同時刻の場合、間隔を空ける
      const waitSec = 30 + Math.random() * 60;
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
  }

  // 単一アカウント投稿
  async runSingle(accountId) {
    const accounts = this._loadAccounts();
    const account = accounts.find(a => a.id === accountId);
    if (!account) return { error: `アカウントが見つかりません: ${accountId}` };
    return this.postForAccount(account);
  }

  // スケジューラー開始 - 毎分チェック
  start() {
    this.stop();

    this.job = cron.schedule('* * * * *', async () => {
      try {
        await this._checkSchedule();
      } catch (e) {
        console.error('スケジュールチェックエラー:', e.message);
      }
    });

    this.running = true;

    // 登録済み時刻の表示
    const accounts = this._loadAccounts();
    console.log(`📅 スケジューラー開始（毎分チェック）`);
    for (const a of accounts) {
      if (a.scheduleTimes && a.scheduleTimes.length > 0) {
        console.log(`   ${a.name}: ${a.scheduleTimes.join(', ')}`);
      }
    }
  }

  // スケジューラー停止
  stop() {
    if (this.job) {
      this.job.stop();
      this.job = null;
    }
    this.running = false;
  }

  getStatus() {
    const accounts = this._loadAccounts();
    const schedules = accounts
      .filter(a => a.scheduleTimes && a.scheduleTimes.length > 0)
      .map(a => ({ name: a.name, times: a.scheduleTimes }));

    return {
      running: this.running,
      ...this.status,
      schedules
    };
  }
}

module.exports = new Scheduler();
