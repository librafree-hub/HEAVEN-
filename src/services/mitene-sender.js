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

  // ログイン（cityhaven-posterと同じ流れ）
  async _login(page, account) {
    const loginUrl = account.loginUrl || 'https://spgirl.cityheaven.net/J1Login.php';
    console.log(`  🔑 ログイン中: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await this._wait(2000);

    try {
      await page.waitForSelector('#userid', { timeout: 10000 });
      await page.type('#userid', account.loginId, { delay: 50 });
      console.log(`  ✏️ ID入力完了`);

      await page.type('#passwd', account.loginPassword, { delay: 50 });
      console.log(`  ✏️ パスワード入力完了`);

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

  // ミテネページに移動してボタンを押す
  async _sendMitene(page, account) {
    try {
      // ミテネページURL（アカウント設定 or メインページから探す）
      const miteneUrl = account.miteneUrl || '';

      if (miteneUrl) {
        // 直接URLが設定されている場合
        console.log(`  📝 ミテネページへ移動: ${miteneUrl}`);
        await page.goto(miteneUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await this._wait(3000);
      } else {
        // メインページからミテネリンクを探す
        console.log(`  🔍 メインページからミテネリンクを検索中...`);
        const mainUrl = 'https://spgirl.cityheaven.net/J1Main.php';
        await page.goto(mainUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await this._wait(3000);

        // ミテネ/キテネ関連のリンクを探してクリック
        const miteneLink = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a'));
          const found = links.find(a => {
            const text = (a.textContent || '').trim();
            return text.match(/ミテネ|みてね|キテネ|きてね|MITENE|KITENE/i);
          });
          if (found) {
            return found.href;
          }
          return null;
        });

        if (miteneLink) {
          console.log(`  📎 ミテネリンク発見: ${miteneLink}`);
          await page.goto(miteneLink, { waitUntil: 'networkidle2', timeout: 30000 });
          await this._wait(3000);
        } else {
          // サイドメニューやナビゲーションからも探す
          console.log(`  🔍 ナビゲーションからミテネリンクを検索中...`);
          const allLinks = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a')).map(a => ({
              text: (a.textContent || '').trim().substring(0, 50),
              href: a.href
            }));
          });
          console.log(`  📋 ページ内リンク: ${allLinks.length}個`);

          // URLパターンでもミテネページを探す
          const miteneByUrl = allLinks.find(l =>
            l.href.match(/kitene|mitene/i)
          );
          if (miteneByUrl) {
            console.log(`  📎 URLパターンで発見: ${miteneByUrl.href}`);
            await page.goto(miteneByUrl.href, { waitUntil: 'networkidle2', timeout: 30000 });
            await this._wait(3000);
          } else {
            await this._screenshot(page, 'mitene-not-found');
            // リンク一覧をログに出力（デバッグ用）
            for (const l of allLinks.filter(l => l.text.length > 0)) {
              console.log(`    - ${l.text} → ${l.href}`);
            }
            throw new Error('ミテネページが見つかりません。miteneUrlを設定してください');
          }
        }
      }

      await this._screenshot(page, 'mitene-page');
      console.log(`  📍 ミテネページURL: ${page.url()}`);

      // ページ内のフォーム要素とボタンを検出
      const pageInfo = await page.evaluate(() => {
        const forms = Array.from(document.querySelectorAll('form'));
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, a[class*="btn"]'));
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));

        return {
          forms: forms.length,
          buttons: buttons.map(b => ({
            tag: b.tagName,
            type: b.type || '',
            text: (b.textContent || b.value || '').trim().substring(0, 50),
            id: b.id || '',
            name: b.name || '',
            className: b.className || ''
          })),
          checkboxes: checkboxes.map(c => ({
            id: c.id || '',
            name: c.name || '',
            checked: c.checked,
            label: c.parentElement?.textContent?.trim().substring(0, 50) || ''
          }))
        };
      });

      console.log(`  📋 ページ要素: フォーム${pageInfo.forms}個, ボタン${pageInfo.buttons.length}個, チェックボックス${pageInfo.checkboxes.length}個`);

      // ミテネ送信ボタンを探してクリック
      // パターン1: 「ミテネ送信」「一括送信」「送信」などのボタン
      const result = await page.evaluate(() => {
        const results = { clicked: 0, details: [] };

        // まず「全選択」「全チェック」ボタンがあれば押す
        const selectAllBtns = Array.from(document.querySelectorAll('button, input[type="button"], a'));
        const selectAll = selectAllBtns.find(b => {
          const text = (b.textContent || b.value || '').trim();
          return text.match(/全選択|全てチェック|すべて選択|全員|一括チェック/);
        });
        if (selectAll) {
          selectAll.click();
          results.details.push(`全選択ボタンクリック: "${(selectAll.textContent || selectAll.value || '').trim()}"`);
        }

        // 全チェックボックスを選択
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        let checkedCount = 0;
        for (const cb of checkboxes) {
          if (!cb.checked && !cb.disabled) {
            cb.checked = true;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
            checkedCount++;
          }
        }
        if (checkedCount > 0) {
          results.details.push(`チェックボックス選択: ${checkedCount}個`);
        }

        // 送信ボタンを探す
        const allBtns = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a'));
        const sendBtn = allBtns.find(b => {
          const text = (b.textContent || b.value || '').trim();
          return text.match(/ミテネ.*送信|みてね.*送信|送信|一括送信|キテネ.*送信|実行/);
        });

        if (sendBtn) {
          sendBtn.click();
          results.clicked = 1;
          results.details.push(`送信ボタンクリック: "${(sendBtn.textContent || sendBtn.value || '').trim()}"`);
        }

        return results;
      });

      for (const detail of result.details) {
        console.log(`  🔘 ${detail}`);
      }

      if (result.clicked === 0) {
        // 個別のミテネボタンを探す（各ユーザー横のボタン）
        console.log(`  🔍 個別ミテネボタンを検索中...`);
        const individualResult = await page.evaluate(() => {
          const results = { clicked: 0, details: [] };
          const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'));
          const miteneButtons = buttons.filter(b => {
            const text = (b.textContent || b.value || '').trim();
            return text.match(/ミテネ|みてね|キテネ|きてね|送信/);
          });

          for (const btn of miteneButtons) {
            btn.click();
            results.clicked++;
            results.details.push(`ボタンクリック: "${(btn.textContent || btn.value || '').trim()}"`);
          }
          return results;
        });

        for (const detail of individualResult.details) {
          console.log(`  🔘 ${detail}`);
        }
        result.clicked += individualResult.clicked;
      }

      await this._wait(3000);

      // 確認ダイアログ/確認ページの処理
      const confirmResult = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]'));
        const confirmBtn = btns.find(b => {
          const text = (b.textContent || b.value || '').trim();
          return text.match(/OK|はい|確定|送信|実行/);
        });
        if (confirmBtn) {
          confirmBtn.click();
          return (confirmBtn.textContent || confirmBtn.value || '').trim();
        }
        return null;
      });

      if (confirmResult) {
        console.log(`  🔘 確認ボタンクリック: "${confirmResult}"`);
        await this._wait(3000);
      }

      // ダイアログハンドリング（window.confirm等）
      // Puppeteerのdialogイベントは事前に設定が必要なので、
      // page作成時に設定する

      await this._screenshot(page, 'mitene-after-send');

      if (result.clicked > 0) {
        console.log(`  ✅ ミテネ送信完了: ${result.clicked}件`);
        return { success: true, count: result.clicked };
      } else {
        console.log(`  ⚠️ ミテネボタンが見つかりませんでした`);
        await this._screenshot(page, 'mitene-no-buttons');
        // ページ構造をログに出力
        for (const btn of pageInfo.buttons) {
          console.log(`    ボタン: [${btn.tag}] "${btn.text}" id=${btn.id} name=${btn.name}`);
        }
        return { success: false, error: 'ミテネボタンが見つかりませんでした', pageInfo };
      }
    } catch (e) {
      await this._screenshot(page, 'mitene-error');
      console.error(`  ❌ ミテネ送信失敗: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  // メイン処理
  async send(account) {
    let page = null;
    try {
      const browser = await this._launchBrowser();
      page = await browser.newPage();

      // ダイアログ自動承認
      page.on('dialog', async dialog => {
        console.log(`  💬 ダイアログ: ${dialog.message()}`);
        await dialog.accept();
      });

      const loggedIn = await this._login(page, account);
      if (!loggedIn) return { success: false, error: 'ログイン失敗' };

      const result = await this._sendMitene(page, account);
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      if (page) await page.close().catch(() => {});
      await this._closeBrowser();
    }
  }
}

module.exports = new MiteneSender();
