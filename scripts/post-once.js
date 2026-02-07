require('dotenv').config();
const scheduler = require('../src/services/scheduler');

async function main() {
  console.log('');
  console.log('=== HEAVEN 手動投稿（1回実行） ===');
  console.log('');

  const result = await scheduler.runOnce();

  console.log('');
  console.log('=== 結果 ===');
  if (result.error) {
    console.log(`エラー: ${result.error}`);
  } else {
    for (const r of result.results) {
      const icon = r.success ? '✅' : '❌';
      console.log(`${icon} ${r.account}: ${r.error || (r.mode === 'test' ? 'テストモード' : '成功')}`);
    }
  }

  process.exit(0);
}

main().catch(e => {
  console.error('実行エラー:', e);
  process.exit(1);
});
