const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, '../../data/logs');

class MiteneSender {
  constructor() {
    this.browser = null;
  }

  async _launchBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1280, height: 900 },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ja']
      });
    }
    return this.browser;
  }

  async _closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _screenshot(page, name) {
    try {
      if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const filePath = path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.png`);
      await page.screenshot({ path: filePath, fullPage: true });
      console.log(`  📷 スクショ保存: ${filePath}`);
    } catch (e) { /* 無視 */ }
  }

  // ステップ1: 姫デコログイン
  async _login(page, account) {
    const loginUrl = account.loginUrl || 'https://spgirl.cityheaven.net/J1Login.php';
    console.log(`  🔑 姫デコログイン中: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await this._wait(2000);

    try {
      await page.waitForSelector('#userid', { timeout: 10000 });
      await page.type('#userid', account.loginId, { delay: 50 });
      await page.type('#passwd', account.loginPassword, { delay: 50 });
      console.log(`  ✏️ ID/パスワード入力完了`);

      await page.click('#loginBtn');
      await this._wait(5000);

      const currentUrl = page.url();
      console.log(`  📍 ログイン後URL: ${currentUrl}`);
      if (currentUrl.includes('Login')) {
        throw new Error('ログイン失敗 - ID/パスワードを確認');
      }
      console.log(`  ✅ ログイン完了`);
      return true;
    } catch (e) {
      await this._screenshot(page, 'mitene-login-error');
      console.error(`  ❌ ログイン失敗: ${e.message}`);
      return false;
    }
  }

  // ステップ2: トップページで「キテネできる会員を探す」を押す
  async _findMembers(page) {
    console.log(`  🔍 トップページで「キテネできる会員を探す」を検索中...`);
    await this._screenshot(page, 'mitene-top-page');

    // リンクやボタンを探してクリック
    const clicked = await page.evaluate(() => {
      const elements = [...document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')];
      const target = elements.find(el => {
        const text = (el.textContent || el.value || '').trim();
        return text.includes('キテネできる会員を探す') ||
               text.includes('ミテネできる会員を探す') ||
               text.includes('キテネできる会員') ||
               text.includes('ミテネできる会員');
      });
      if (target) {
        target.click();
        return (target.textContent || target.value || '').trim().substring(0, 50);
      }
      return null;
    });

    if (clicked) {
      console.log(`  ✅ 「${clicked}」をクリック`);
      await this._wait(5000);
      await this._screenshot(page, 'mitene-member-list');
      return true;
    }

    // 見つからない場合、ページ内のリンク一覧をログ出力
    console.log(`  ⚠️ ボタンが見つかりません。ページ内のリンクを確認中...`);
    const allLinks = await page.evaluate(() => {
      return [...document.querySelectorAll('a')].map(a => ({
        text: (a.textContent || '').trim().substring(0, 60),
        href: a.href
      })).filter(l => l.text.length > 0);
    });

    // URLパターンでも探す（kitene, mitene を含むURL）
    const byUrl = allLinks.find(l =>
      l.href.match(/kitene|mitene|Kitene|Mitene/i)
    );
    if (byUrl) {
      console.log(`  📎 URLパターンで発見: ${byUrl.text} → ${byUrl.href}`);
      await page.goto(byUrl.href, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._wait(3000);
      await this._screenshot(page, 'mitene-member-list');
      return true;
    }

    // デバッグ: 全リンクを出力
    for (const l of allLinks.slice(0, 30)) {
      console.log(`    - ${l.text} → ${l.href}`);
    }
    await this._screenshot(page, 'mitene-search-not-found');
    return false;
  }

  // ステップ3: 「キテネを送る」を押す（最大maxSends回）
  async _sendToMembers(page, maxSends, minWeeks) {
    console.log(`  👋 会員リストからミテネ送信中（最大${maxSends}件）...`);

    let sentCount = 0;

    // ページ内の送信ボタンを探す
    // 各会員の横に「キテネを送る」「ミテネを送る」ボタンがあるはず
    const memberInfo = await page.evaluate((minWeeksVal) => {
      const results = [];
      // 送信ボタンを全部取得
      const buttons = [...document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')];
      const sendButtons = buttons.filter(b => {
        const text = (b.textContent || b.value || '').trim();
        return text.match(/キテネを送る|ミテネを送る|キテネ送信|ミテネ送信|送る/);
      });

      for (const btn of sendButtons) {
        // ボタンの親要素周辺から送付済み情報を探す
        const parent = btn.closest('tr') || btn.closest('li') || btn.closest('div') || btn.parentElement;
        const parentText = (parent?.textContent || '').trim();

        // 「X月X日に送付済み」パターンを検出
        const sentMatch = parentText.match(/(\d{1,2})月(\d{1,2})日.*送付済/);
        let sentDate = null;
        let skipReason = null;

        if (sentMatch && minWeeksVal > 0) {
          const now = new Date();
          const year = now.getFullYear();
          const month = parseInt(sentMatch[1]) - 1;
          const day = parseInt(sentMatch[2]);
          sentDate = new Date(year, month, day);

          // 年をまたぐ場合（例：12月の送付を1月に見る）
          if (sentDate > now) {
            sentDate = new Date(year - 1, month, day);
          }

          const weeksDiff = (now - sentDate) / (7 * 24 * 60 * 60 * 1000);
          if (weeksDiff < minWeeksVal) {
            skipReason = `${sentMatch[1]}月${sentMatch[2]}日送付済（${Math.floor(weeksDiff)}週間前）`;
          }
        }

        results.push({
          text: (btn.textContent || btn.value || '').trim().substring(0, 30),
          sentDate: sentDate ? sentDate.toISOString() : null,
          skipReason
        });
      }
      return results;
    }, minWeeks);

    console.log(`  📋 送信可能ボタン: ${memberInfo.length}個`);

    // 1つずつクリックして送信
    for (let i = 0; i < memberInfo.length && sentCount < maxSends; i++) {
      const info = memberInfo[i];

      if (info.skipReason) {
        console.log(`  ⏭️ スキップ: ${info.skipReason}`);
        continue;
      }

      try {
        // ボタンを再取得してクリック（ページ更新対応）
        const clicked = await page.evaluate((index, minWeeksVal) => {
          const buttons = [...document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')];
          const sendButtons = buttons.filter(b => {
            const text = (b.textContent || b.value || '').trim();
            return text.match(/キテネを送る|ミテネを送る|キテネ送信|ミテネ送信|送る/);
          });

          // スキップ対象を除外してindex番目のボタン
          let clickIndex = 0;
          for (const btn of sendButtons) {
            const parent = btn.closest('tr') || btn.closest('li') || btn.closest('div') || btn.parentElement;
            const parentText = (parent?.textContent || '').trim();
            const sentMatch = parentText.match(/(\d{1,2})月(\d{1,2})日.*送付済/);

            let shouldSkip = false;
            if (sentMatch && minWeeksVal > 0) {
              const now = new Date();
              const year = now.getFullYear();
              const month = parseInt(sentMatch[1]) - 1;
              const day = parseInt(sentMatch[2]);
              let sentDate = new Date(year, month, day);
              if (sentDate > now) sentDate = new Date(year - 1, month, day);
              const weeksDiff = (now - sentDate) / (7 * 24 * 60 * 60 * 1000);
              if (weeksDiff < minWeeksVal) shouldSkip = true;
            }

            if (shouldSkip) continue;

            if (clickIndex === index) {
              btn.click();
              return true;
            }
            clickIndex++;
          }
          return false;
        }, sentCount, minWeeks);

        if (clicked) {
          sentCount++;
          console.log(`  ✅ ミテネ送信 ${sentCount}/${maxSends}`);
          await this._wait(3000);

          // 確認ダイアログが出る場合
          const confirmClicked = await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button, input[type="submit"], input[type="button"]')];
            const confirmBtn = btns.find(b => {
              const text = (b.textContent || b.value || '').trim();
              return text.match(/OK|はい|確定|送信|実行/);
            });
            if (confirmBtn) {
              confirmBtn.click();
              return true;
            }
            return false;
          });

          if (confirmClicked) {
            console.log(`  🔘 確認ボタンクリック`);
            await this._wait(2000);
          }
        }
      } catch (e) {
        console.log(`  ⚠️ 送信${sentCount + 1}件目でエラー: ${e.message}`);
      }
    }

    await this._screenshot(page, 'mitene-after-send');
    return { success: sentCount > 0, count: sentCount };
  }

  // メイン処理
  async send(account, settings = {}) {
    const maxSends = settings.miteneMaxSends || 10;
    const minWeeks = settings.miteneMinWeeks || 0;

    let page = null;
    try {
      const browser = await this._launchBrowser();
      page = await browser.newPage();

      // ダイアログ自動承認
      page.on('dialog', async dialog => {
        console.log(`  💬 ダイアログ: ${dialog.message()}`);
        await dialog.accept();
      });

      console.log(`\n👋 ミテネ送信開始: ${account.name}`);
      console.log(`  設定: 最大${maxSends}件送信, ${minWeeks > 0 ? minWeeks + '週間以上経過した人のみ' : '制限なし'}`);

      // ステップ1: ログイン
      const loggedIn = await this._login(page, account);
      if (!loggedIn) return { success: false, error: 'ログイン失敗' };

      // ステップ2: 「キテネできる会員を探す」をクリック
      const found = await this._findMembers(page);
      if (!found) return { success: false, error: '「キテネできる会員を探す」が見つかりません' };

      // ステップ3: 会員に送信（最大10件）
      const result = await this._sendToMembers(page, maxSends, minWeeks);

      console.log(`  🏁 送信完了: ${result.count}件`);
      return result;
    } catch (e) {
      console.error(`  ❌ ミテネ送信エラー: ${e.message}`);
      return { success: false, error: e.message };
    } finally {
      if (page) await page.close().catch(() => {});
      await this._closeBrowser();
    }
  }
}

module.exports = new MiteneSender();
