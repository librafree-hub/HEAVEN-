require('dotenv').config();
const scheduler = require('../src/services/scheduler');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('');
  console.log('=== HEAVEN テスト投稿 ===');
  console.log('');

  // アカウント読み込み
  const accountsPath = path.join(__dirname, '../config/accounts.json');
  if (!fs.existsSync(accountsPath)) {
    console.log('❌ config/accounts.json が見つかりません');
    process.exit(1);
  }

  const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
  const active = accounts.filter(a => a.active);

  if (active.length === 0) {
    console.log('❌ 有効なアカウントがありません');
    process.exit(1);
  }

  const testAccount = active[0];
  console.log(`テストアカウント: ${testAccount.name}`);
  console.log('投稿モード: テスト（実際の投稿はしません）');
  console.log('');

  const result = await scheduler.postForAccount(testAccount);

  console.log('');
  console.log('=== テスト結果 ===');
  if (result.success) {
    console.log('✅ 成功');
    if (result.diary) {
      console.log(`タイトル: ${result.diary.title}`);
      console.log(`文字数: ${result.diary.charCount}`);
    }
  } else {
    console.log(`❌ 失敗: ${result.error}`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('実行エラー:', e);
  process.exit(1);
});
