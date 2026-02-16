const { execFile } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '../../');

// クラウド環境の場合、GitHubトークンでリモートURLを設定
async function setupCloudGit() {
  const token = process.env.GIT_TOKEN;
  const repo = process.env.GIT_REPO; // 例: username/HEAVEN
  if (!token || !repo) return;

  await run(['config', 'user.email', 'heaven@auto.system']);
  await run(['config', 'user.name', 'HEAVEN System']);
  // トークン付きURLでoriginを更新
  const url = `https://${token}@github.com/${repo}.git`;
  await run(['remote', 'set-url', 'origin', url]);
  console.log('☁️  GitHub連携設定済み');
}

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
    await setupCloudGit();
    const result = await run(['pull', '--rebase', '--autostash']);
    if (result !== false) {
      console.log('✅ 同期完了');
    }
  },

  // config変更後に自動コミット＆プッシュ
  // 他のPCの変更も取り込んでからpushする
  async push(message) {
    await run(['add', 'config/']);
    await run(['add', 'data/db/']);
    const status = await run(['status', '--porcelain', 'config/', 'data/db/']);
    if (!status) return; // 変更なし

    await run(['commit', '-m', message || '設定データ更新']);
    // push前に他PCの変更を取り込む（競合回避）
    await run(['pull', '--rebase', '--autostash']);
    const result = await run(['push']);
    if (result !== false) {
      console.log('☁️  設定データをクラウドに保存しました');
    }
  }
};
