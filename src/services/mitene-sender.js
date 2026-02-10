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

  // ステップ3: 「キテネを送る」「ミテネを送る」を1つずつ押す
  async _sendToMembers(page, maxSends, minWeeks) {
    console.log(`  👋 会員リストからミテネ送信中（最大${maxSends}件）...`);

    // 会員リストのURLを保存（送信後に戻るため）
    const memberListUrl = page.url();
    console.log(`  📍 会員リストURL: ${memberListUrl}`);

    // まずページ上のボタン構造をデバッグ出力
    const debugInfo = await page.evaluate(() => {
      const allElements = [...document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')];
      const matched = allElements.filter(el => {
        const text = (el.textContent || el.value || '').trim();
        return text.match(/キテネ|ミテネ|送る/);
      });
      return matched.map(el => ({
        tag: el.tagName,
        text: (el.textContent || el.value || '').trim().substring(0, 50),
        href: el.href || null,
        onclick: el.getAttribute('onclick') || null,
        className: el.className || null,
        html: el.outerHTML.substring(0, 300)
      }));
    });
    console.log(`  🔍 ボタン構造デバッグ (${debugInfo.length}個):`);
    for (const d of debugInfo) {
      console.log(`    [${d.tag}] text="${d.text}" href="${d.href}" onclick="${d.onclick}" class="${d.className}"`);
      console.log(`    HTML: ${d.html}`);
    }

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

    let sentCount = 0;

    for (let attempt = 0; attempt < maxSends; attempt++) {
      try {
        // ボタンのhrefを取得（<a>の場合、hrefを直接使ってページ遷移を防ぐ）
        const btnData = await page.evaluate((minWeeksVal) => {
          const allElements = [...document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')];
          const sendButtons = allElements.filter(el => {
            const text = (el.textContent || el.value || '').trim();
            return text.match(/キテネを送る|ミテネを送る/);
          });

          if (sendButtons.length === 0) return null;

          for (const btn of sendButtons) {
            const parent = btn.closest('tr') || btn.closest('li') || btn.closest('div.member') || btn.closest('div') || btn.parentElement;
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

            if (!shouldSkip) {
              // hrefを奪い取ってページ遷移を防止
              const href = btn.href || null;
              const onclick = btn.getAttribute('onclick') || null;
              if (btn.tagName === 'A') {
                btn.removeAttribute('href');
              }
              return {
                href,
                onclick,
                tag: btn.tagName,
                text: (btn.textContent || '').trim().substring(0, 30),
                total: sendButtons.length
              };
            }
          }
          return { allSkipped: true };
        }, minWeeks);

        if (!btnData) {
          console.log(`  📋 送信ボタンなし。完了。`);
          break;
        }
        if (btnData.allSkipped) {
          console.log(`  ⏭️ 全てスキップ対象。`);
          break;
        }

        console.log(`  🖱️ 「${btnData.text}」(${btnData.tag}) href=${btnData.href} onclick=${btnData.onclick}`);

        // hrefを除去したボタンをクリック → onclickのみ発火（confirm + 送信処理）
        await page.evaluate(() => {
          const allElements = [...document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')];
          const btn = allElements.find(el => {
            const text = (el.textContent || el.value || '').trim();
            return text.match(/キテネを送る|ミテネを送る/) && !el.href;
          });
          if (btn) btn.click();
        });

        // confirm ダイアログは page.on('dialog') で自動承認
        await this._wait(3000);

        // ナビゲーションが発生した場合（客ページに飛んだ場合）→ 会員リストに戻る
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

        await this._screenshot(page, `mitene-sent-${sentCount}`);
      } catch (e) {
        console.log(`  ⚠️ 送信${sentCount + 1}件目エラー: ${e.message}`);
        await this._screenshot(page, 'mitene-send-error');
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
