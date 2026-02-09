const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const database = require('./database');
const imageManager = require('./image-manager');
const aiGenerator = require('./ai-generator');
const poster = require('./cityhaven-poster');

class Scheduler {
  constructor() {
    this.jobs = [];
    this.running = false;
    this.status = { lastRun: null, nextRun: null, isRunning: false };
  }

  // スケジュール設定からcron式を生成
  _buildCronExpression(settings) {
    const startHour = settings.scheduleStartHour ?? 0;
    const endHour = settings.scheduleEndHour ?? 23;
    const interval = settings.scheduleInterval ?? 3;

    // 24時間の場合
    if (startHour === 0 && endHour === 23) {
      return `0 0 */${interval} * * *`;
    }
    // 時間帯指定
    return `0 0 ${startHour}-${endHour}/${interval} * * *`;
  }

  // 次回の投稿予定時刻を計算
  _calcNextPostTimes(settings) {
    const startHour = settings.scheduleStartHour ?? 0;
    const endHour = settings.scheduleEndHour ?? 23;
    const interval = settings.scheduleInterval ?? 3;
    const hours = [];
    for (let h = startHour; h <= endHour; h += interval) {
      hours.push(h);
    }
    return hours;
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

      // 投稿タイプ: diary / freepost / random
      const postTypeSetting = account.postType || settings.postType || 'diary';
      if (postTypeSetting === 'random') {
        postOptions.postType = Math.random() < 0.5 ? 'diary' : 'freepost';
      } else {
        postOptions.postType = postTypeSetting;
      }

      // 公開範囲: public / mygirl / random
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

  // 全アカウント投稿（1回実行）
  async runOnce() {
    if (this.status.isRunning) {
      return { error: '既に実行中です' };
    }

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

      // アカウント間に間隔を空ける（2〜5分）
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

  // 単一アカウント投稿
  async runSingle(accountId) {
    const accounts = this._loadAccounts();
    const account = accounts.find(a => a.id === accountId);
    if (!account) return { error: `アカウントが見つかりません: ${accountId}` };
    return this.postForAccount(account);
  }

  // スケジュール開始
  start() {
    const settings = this._loadSettings();
    // 新形式（時間帯+間隔）があればそこからcron生成、なければ旧形式フォールバック
    const cronExpression = (settings.scheduleInterval != null)
      ? this._buildCronExpression(settings)
      : (settings.schedule || '0 0 */3 * * *');

    this.stop();

    const job = cron.schedule(cronExpression, async () => {
      console.log(`\n⏰ スケジュール実行: ${new Date().toLocaleString('ja-JP')}`);
      await this.runOnce();
    });

    this.jobs.push(job);
    this.running = true;
    const postHours = this._calcNextPostTimes(settings);
    this.status.nextRun = '次のスケジュール時刻';
    this.status.postHours = postHours;
    console.log(`📅 スケジューラー開始: ${cronExpression}`);
    console.log(`   投稿予定時刻: ${postHours.map(h => h + '時').join(', ')}`);
  }

  // スケジュール停止
  stop() {
    for (const job of this.jobs) {
      job.stop();
    }
    this.jobs = [];
    this.running = false;
  }

  getStatus() {
    return {
      running: this.running,
      ...this.status
    };
  }
}

module.exports = new Scheduler();
