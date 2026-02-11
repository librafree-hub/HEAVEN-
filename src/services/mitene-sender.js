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

  // ステップ2: トップページで「キテネできる会員を探す」「ミテネできる会員を探す」を押す
  async _findMembers(page) {
    console.log(`  🔍 トップページで「キテネ/ミテネできる会員を探す」を検索中...`);
    await this._screenshot(page, 'mitene-top-page');

    // まずリンクやボタンのテキストで探す
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

    // 見つからない場合、URLパターンで探す（J10ComeonVisitorList.php）
    console.log(`  ⚠️ テキストで見つからず。URLパターンで検索中...`);
    const allLinks = await page.evaluate(() => {
      return [...document.querySelectorAll('a')].map(a => ({
        text: (a.textContent || '').trim().substring(0, 60),
        href: a.href
      })).filter(l => l.text.length > 0);
    });

    // J10ComeonVisitorList.php が実際のURL
    const byUrl = allLinks.find(l =>
      l.href.match(/ComeonVisitor|kitene|mitene/i)
    );
    if (byUrl) {
      console.log(`  📎 URLパターンで発見: ${byUrl.text} → ${byUrl.href}`);
      await page.goto(byUrl.href, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._wait(3000);
      await this._screenshot(page, 'mitene-member-list');
      return true;
    }

    // デバッグ: 全リンクを出力
    console.log(`  ❌ ボタンもURLも見つかりません。ページ内のリンク:`);
    for (const l of allLinks.slice(0, 30)) {
      console.log(`    - ${l.text} → ${l.href}`);
    }
    await this._screenshot(page, 'mitene-search-not-found');
    return false;
  }

  // 残り回数を読み取る
  async _getRemainingCount(page) {
    const remaining = await page.evaluate(() => {
      const text = document.body.innerText;
      // 「残り回数: 10/10」「残り回数：8/10」などのパターン
      const match = text.match(/残り回数[：:]\s*(\d+)\s*[/／]\s*(\d+)/);
      if (match) {
        return { remaining: parseInt(match[1]), total: parseInt(match[2]) };
      }
      return null;
    });
    return remaining;
  }

  // ステップ3: ランダムにタブを選んでからregistComeon(uid)で送る
  async _sendToMembers(page, maxSends, minWeeks) {
    console.log(`  👋 会員リストからミテネ送信中（最大${maxSends}件）...`);

    // URLからgidを取得
    const currentUrl = page.url();
    const gidMatch = currentUrl.match(/gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : null;
    console.log(`  📍 現在のURL: ${currentUrl} (gid=${gid})`);

    // ランダムにタブを選んでURL直接遷移（みたよ / マイガール / マッチ率）
    const tabOptions = [
      { name: 'みたよ', path: 'J10ComeonVisitorList.php' },
      { name: 'マイガール', path: 'J10ComeonMyGirlList.php' },
      { name: 'マッチ率', path: 'J10ComeonAiMatchingList.php' }
    ];
    const pick = tabOptions[Math.floor(Math.random() * tabOptions.length)];

    if (gid) {
      const tabUrl = `https://spgirl.cityheaven.net/${pick.path}?gid=${gid}`;
      console.log(`  🎲 タブ「${pick.name}」をランダム選択 → ${tabUrl}`);
      await page.goto(tabUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._wait(2000);
    } else {
      console.log(`  ⚠️ gid取得できず。現在のページのまま続行。`);
    }

    // 会員リストのURLを保存（送信後に戻るため）
    const memberListUrl = page.url();

    // 残り回数を確認
    const countInfo = await this._getRemainingCount(page);
    if (countInfo) {
      console.log(`  📊 残り回数: ${countInfo.remaining}/${countInfo.total}`);
      if (countInfo.remaining === 0) {
        console.log(`  ⚠️ 残り回数が0です。送信できません。`);
        return { success: false, count: 0, error: '残り回数が0です' };
      }
      if (countInfo.remaining < maxSends) {
        maxSends = countInfo.remaining;
        console.log(`  📊 残り回数に合わせて最大${maxSends}件に調整`);
      }
    }

    // registComeon(uid) のuidを全部取得
    const uids = await page.evaluate(() => {
      const buttons = document.querySelectorAll('a.kitene_send_btn__text_wrapper, a.mitene_send_btn__text_wrapper');
      const ids = [];
      for (const btn of buttons) {
        const onclick = btn.getAttribute('onclick') || '';
        const match = onclick.match(/registComeon\((\d+)\)/);
        if (match) ids.push(match[1]);
      }
      // クラス名で見つからない場合、onclick属性で探す
      if (ids.length === 0) {
        const allLinks = document.querySelectorAll('a[onclick*="registComeon"]');
        for (const link of allLinks) {
          const onclick = link.getAttribute('onclick') || '';
          const match = onclick.match(/registComeon\((\d+)\)/);
          if (match) ids.push(match[1]);
        }
      }
      return ids;
    });

    console.log(`  📋 送信対象: ${uids.length}人 (uid: ${uids.join(', ')})`);

    if (uids.length === 0) {
      console.log(`  ⚠️ 送信対象が見つかりません。`);
      return { success: false, count: 0, error: '送信対象が見つかりません' };
    }

    let sentCount = 0;

    for (let i = 0; i < uids.length && sentCount < maxSends; i++) {
      const uid = uids[i];
      try {
        console.log(`  🖱️ registComeon(${uid}) 呼び出し中... (${sentCount + 1}/${maxSends})`);

        // registComeon(uid) を直接呼び出す → confirm("キテネしますか？") が出る → 自動承認
        await page.evaluate((id) => {
          registComeon(parseInt(id));
        }, uid);

        // confirm ダイアログは page.on('dialog') で自動承認
        await this._wait(3000);

        // ページ遷移が発生した場合、会員リストに戻る
        const currentUrl = page.url();
        if (currentUrl !== memberListUrl) {
          console.log(`  📍 遷移検知: ${currentUrl}`);
          console.log(`  🔙 会員リストに戻る...`);
          await page.goto(memberListUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          await this._wait(2000);
        }

        sentCount++;
        console.log(`  ✅ ミテネ送信 ${sentCount}/${maxSends}`);

        // 残り回数を確認
        const afterCount = await this._getRemainingCount(page);
        if (afterCount) {
          console.log(`  📊 残り回数: ${afterCount.remaining}/${afterCount.total}`);
          if (afterCount.remaining === 0) {
            console.log(`  🏁 残り回数0。`);
            break;
          }
        }
      } catch (e) {
        console.log(`  ⚠️ uid=${uid} 送信エラー: ${e.message}`);
        // エラー時も会員リストに戻って続行
        try {
          await page.goto(memberListUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          await this._wait(2000);
        } catch (navErr) {
          console.log(`  ❌ 復帰失敗: ${navErr.message}`);
          break;
        }
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

      // ダイアログ自動承認（「キテネしますか？」「ミテネしますか？」にOKを押す）
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
      if (!found) return { success: false, error: '「キテネ/ミテネできる会員を探す」が見つかりません' };

      // ステップ3: 会員に1人ずつ送信（ボタンクリック→確認ダイアログOK→ページに戻る→繰り返し）
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
