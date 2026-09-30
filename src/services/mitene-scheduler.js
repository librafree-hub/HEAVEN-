const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const database = require('./database');
const miteneSender = require('./mitene-sender');

const ACCOUNTS_PATH = path.join(__dirname, '../../config/mitene-accounts.json');
const SETTINGS_PATH = path.join(__dirname, '../../config/settings.json');

class MiteneScheduler {
  constructor() {
    this.jobs = {};       // accountId -> cron job
    this.running = false;
    this.accountStatus = {}; // accountId -> { lastRun, isRunning, lastResult }
  }

  _loadAccounts() {
    if (!fs.existsSync(ACCOUNTS_PATH)) return [];
    return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
  }

  _loadSettings() {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  }

  // アカウント別にスケジュール開始
  start() {
    this.stop();
    const accounts = this._loadAccounts().filter(a => a.active);

    for (const account of accounts) {
      if (!account.schedule || !account.loginId) continue;

      // "10:00" → cron "0 10 * * *"（毎日その時刻に実行）
      const parts = account.schedule.split(':');
      const hour = parseInt(parts[0]) || 0;
      const minute = parseInt(parts[1]) || 0;
      const cronExpr = `${minute} ${hour} * * *`;

      const job = cron.schedule(cronExpr, async () => {
        console.log(`\n⏰ [ミテネスケジュール] ${account.name} (${account.schedule})`);
        await this.runSingle(account.id);
      });

      this.jobs[account.id] = job;
      if (!this.accountStatus[account.id]) {
        this.accountStatus[account.id] = { lastRun: null, isRunning: false, lastResult: null };
      }
      console.log(`  📅 ${account.name}: 毎日 ${account.schedule} にミテネ送信`);
    }

    this.running = true;
    console.log(`📅 ミテネスケジューラー開始: ${Object.keys(this.jobs).length}アカウント`);
  }

  stop() {
    for (const [id, job] of Object.entries(this.jobs)) {
      job.stop();
    }
    this.jobs = {};
    this.running = false;
    console.log(`📅 ミテネスケジューラー停止`);
  }

  // 1アカウント分の送信
  async runSingle(accountId) {
    const accounts = this._loadAccounts();
    const account = accounts.find(a => a.id === accountId);
    if (!account) return { error: `アカウントが見つかりません: ${accountId}` };

    if (!account.loginId || !account.loginPassword) {
      return { error: 'ログイン情報が未設定です' };
    }

    if (this.accountStatus[accountId]?.isRunning) {
      return { error: '既に実行中です' };
    }

    this.accountStatus[accountId] = {
      ...this.accountStatus[accountId],
      isRunning: true
    };

    const settings = this._loadSettings();
    const timestamp = new Date().toLocaleTimeString('ja-JP');
    console.log(`\n👋 [${timestamp}] ミテネ送信開始: ${account.name}`);

    try {
      const result = await miteneSender.send(account, settings);

      // 履歴で、その子の上限（20回・50回など）を読み取れたか分かるようにする
      const quota = result.limit ? `（上限${result.limit}回）`
        : result.remainingBefore != null ? `（開始時の残り${result.remainingBefore}回）`
        : result.count > 0 ? '（残り回数読み取れず）' : '';
      const aborted = result.abortReason ? `（${result.abortReason}で中断）` : '';
      const sentSummary = `${result.count || 0}件送信${quota}${result.skipped ? `（スキップ${result.skipped}人）` : ''}${aborted}`;

      database.addPost({
        accountId: account.id,
        accountName: account.name,
        title: 'ミテネ送信',
        body: '',
        charCount: 0,
        image: '',
        postType: 'mitene',
        status: result.success ? 'success' : 'failed',
        message: result.message || (result.success ? sentSummary : (result.error || '不明なエラー'))
      });

      this.accountStatus[accountId] = {
        lastRun: new Date().toISOString(),
        isRunning: false,
        lastResult: result
      };

      if (result.message) {
        console.log(`  ℹ️ ${account.name}: ${result.message}`);
      } else if (result.success) {
        console.log(`  ✅ ${account.name}: ミテネ送信成功 ${sentSummary}`);
      } else {
        console.log(`  ❌ ${account.name}: ミテネ送信失敗 - ${result.error || '不明なエラー'}`);
      }

      return result;
    } catch (e) {
      console.error(`  ❌ ${account.name}: ミテネエラー - ${e.message}`);
      database.addPost({
        accountId: account.id,
        accountName: account.name,
        title: 'ミテネ送信',
        body: '',
        charCount: 0,
        image: '',
        postType: 'mitene',
        status: 'failed',
        message: e.message
      });
      this.accountStatus[accountId] = {
        ...this.accountStatus[accountId],
        isRunning: false,
        lastResult: { success: false, error: e.message }
      };
      return { success: false, error: e.message };
    }
  }

  // 全アカウント一括送信
  async runAll() {
    const accounts = this._loadAccounts().filter(a => a.active && a.loginId);
    const results = [];

    console.log(`\n👋 ミテネ一括送信: ${accounts.length}アカウント`);

    for (const account of accounts) {
      const result = await this.runSingle(account.id);
      results.push({ account: account.name, ...result });

      // アカウント間に間隔を空ける
      if (accounts.indexOf(account) < accounts.length - 1) {
        const waitMin = 1 + Math.random() * 2;
        console.log(`  ⏳ 次のアカウントまで${waitMin.toFixed(1)}分待機...`);
        await new Promise(r => setTimeout(r, waitMin * 60 * 1000));
      }
    }

    console.log(`\n✅ ミテネ一括送信完了`);
    return { results };
  }

  getStatus() {
    return {
      running: this.running,
      accounts: this.accountStatus
    };
  }
}

module.exports = new MiteneScheduler();
