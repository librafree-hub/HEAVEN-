const { execFile } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '../../');

function run(args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: ROOT, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        console.log(`  ⚠ git ${args[0]}: ${stderr || err.message}`);
        resolve(false);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

module.exports = {
  // サーバー起動時に最新を取得
  async pull() {
    console.log('🔄 設定データを同期中...');
    const result = await run(['pull', '--rebase', '--autostash']);
    if (result !== false) {
      console.log('✅ 同期完了');
    }
  },

  // config変更後に自動コミット＆プッシュ
  async push(message) {
    await run(['add', 'config/']);
    const status = await run(['status', '--porcelain', 'config/']);
    if (!status) return; // 変更なし

    await run(['commit', '-m', message || '設定データ更新']);
    const result = await run(['push']);
    if (result !== false) {
      console.log('☁️  設定データをクラウドに保存しました');
    }
  }
};
