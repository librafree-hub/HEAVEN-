const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, '../../data/logs');

class CityHavenPoster {
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

  // スクリーンショット保存（デバッグ用）
  async _screenshot(page, name) {
    try {
      if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const filePath = path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.png`);
      await page.screenshot({ path: filePath, fullPage: true });
      console.log(`  📷 スクショ保存: ${filePath}`);
    } catch (e) { /* 無視 */ }
  }

  // フォーム内のinput要素を自動検出
  async _findInputs(page) {
    return await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
      return inputs.map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        name: el.name || '',
        id: el.id || '',
        placeholder: el.placeholder || '',
        className: el.className || ''
      }));
    });
  }

  // シティヘブンにログイン
  async _login(page, account) {
    const loginUrl = account.loginUrl || 'https://spgirl.cityheaven.net/J1Login.php';

    console.log(`  🔑 ログイン中: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await this._wait(3000);

    // デバッグ: ページ内のフォーム要素を表示
    const inputs = await this._findInputs(page);
    console.log(`  📋 検出されたフォーム要素: ${inputs.length}個`);
    for (const inp of inputs) {
      console.log(`    - <${inp.tag}> type="${inp.type}" name="${inp.name}" id="${inp.id}"`);
    }

    try {
      // テキスト/email入力欄を探す（ログインID用）
      const idInput = inputs.find(i =>
        i.tag === 'input' &&
        (i.type === 'text' || i.type === 'email' || i.type === 'tel') &&
        (i.name.match(/id|mail|user|login|account/i) || i.id.match(/id|mail|user|login|account/i))
      );

      // パスワード入力欄を探す
      const pwInput = inputs.find(i =>
        i.tag === 'input' && i.type === 'password'
      );

      if (!idInput) {
        // ID欄が見つからない場合、最初のtext入力を使う
        const firstText = inputs.find(i => i.tag === 'input' && (i.type === 'text' || i.type === 'email'));
        if (firstText) {
          const sel = firstText.id ? `#${firstText.id}` : `input[name="${firstText.name}"]`;
          await page.type(sel, account.loginId, { delay: 50 });
          console.log(`  ✏️ ID入力完了 (${sel})`);
        } else {
          throw new Error('ログインID入力欄が見つかりません');
        }
      } else {
        const sel = idInput.id ? `#${idInput.id}` : `input[name="${idInput.name}"]`;
        await page.type(sel, account.loginId, { delay: 50 });
        console.log(`  ✏️ ID入力完了 (${sel})`);
      }

      if (!pwInput) {
        throw new Error('パスワード入力欄が見つかりません');
      }
      const pwSel = pwInput.id ? `#${pwInput.id}` : `input[name="${pwInput.name}"]`;
      await page.type(pwSel, account.loginPassword, { delay: 50 });
      console.log(`  ✏️ パスワード入力完了`);

      // スクショ（入力後）
      await this._screenshot(page, 'login-filled');

      // 送信ボタンを探してクリック
      const submitted = await page.evaluate(() => {
        // submit系のボタンを探す
        const btn = document.querySelector('input[type="submit"], button[type="submit"], input[type="image"]');
        if (btn) { btn.click(); return true; }
        // テキストで探す
        const buttons = Array.from(document.querySelectorAll('button, a'));
        const loginBtn = buttons.find(b => b.textContent.includes('ログイン'));
        if (loginBtn) { loginBtn.click(); return true; }
        return false;
      });

      if (!submitted) {
        throw new Error('ログインボタンが見つかりません');
      }

      await this._wait(5000);
      await this._screenshot(page, 'after-login');

      // ログイン成功確認（URLが変わったか）
      const currentUrl = page.url();
      console.log(`  📍 ログイン後URL: ${currentUrl}`);

      if (currentUrl.includes('Login')) {
        throw new Error('ログイン失敗 - ページが変わりませんでした（ID/パスワードを確認）');
      }

      console.log(`  ✅ ログイン完了`);
      return true;
    } catch (e) {
      await this._screenshot(page, 'login-error');
      console.error(`  ❌ ログイン失敗: ${e.message}`);
      return false;
    }
  }

  // 日記を投稿
  async _postDiary(page, account, diary, imagePath) {
    try {
      const diaryUrl = account.diaryUrl || 'https://spgirl.cityheaven.net/J4KeitaiDiaryPost.php';
      console.log(`  📝 日記投稿ページへ移動: ${diaryUrl}`);
      await page.goto(diaryUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._wait(3000);

      // デバッグ: フォーム要素を表示
      const inputs = await this._findInputs(page);
      console.log(`  📋 日記フォーム要素: ${inputs.length}個`);
      for (const inp of inputs) {
        if (inp.type !== 'hidden') {
          console.log(`    - <${inp.tag}> type="${inp.type}" name="${inp.name}" id="${inp.id}"`);
        }
      }

      // タイトル入力欄を探す
      const titleInput = inputs.find(i =>
        i.tag === 'input' &&
        (i.type === 'text') &&
        (i.name.match(/title|subject|sub/i) || i.id.match(/title|subject/i) || i.placeholder.match(/タイトル|件名/))
      );

      if (titleInput) {
        const sel = titleInput.id ? `#${titleInput.id}` : `input[name="${titleInput.name}"]`;
        await page.type(sel, diary.title, { delay: 30 });
        console.log(`  ✏️ タイトル入力完了 (${sel})`);
      } else {
        // 最初のtext入力をタイトルとして使う
        const firstText = inputs.find(i => i.tag === 'input' && i.type === 'text');
        if (firstText) {
          const sel = firstText.id ? `#${firstText.id}` : `input[name="${firstText.name}"]`;
          await page.type(sel, diary.title, { delay: 30 });
          console.log(`  ✏️ タイトル入力完了 (${sel})`);
        }
      }

      // 本文入力欄を探す（textarea）
      const bodyInput = inputs.find(i => i.tag === 'textarea');
      if (bodyInput) {
        const sel = bodyInput.id ? `#${bodyInput.id}` : `textarea[name="${bodyInput.name}"]`;
        await page.type(sel, diary.body, { delay: 5 });
        console.log(`  ✏️ 本文入力完了 (${sel}) - ${diary.body.length}文字`);
      } else {
        throw new Error('本文入力欄（textarea）が見つかりません');
      }

      // 画像アップロード
      if (imagePath && fs.existsSync(imagePath)) {
        const fileInput = inputs.find(i => i.tag === 'input' && i.type === 'file');
        if (fileInput) {
          const sel = fileInput.id ? `#${fileInput.id}` : `input[name="${fileInput.name}"]`;
          const el = await page.$(sel);
          if (el) {
            await el.uploadFile(imagePath);
            console.log(`  📸 画像アップロード完了`);
            await this._wait(3000);
          }
        } else {
          console.log(`  ⚠️ 画像アップロード欄が見つかりません`);
        }
      }

      await this._screenshot(page, 'diary-filled');

      // 投稿ボタンを探す
      const submitted = await page.evaluate(() => {
        // submit系
        const btn = document.querySelector('input[type="submit"], button[type="submit"]');
        if (btn) { btn.click(); return btn.value || btn.textContent || 'submit'; }
        // テキストで探す
        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], a'));
        const postBtn = buttons.find(b =>
          (b.textContent || b.value || '').match(/投稿|送信|確認|登録|post|submit/i)
        );
        if (postBtn) { postBtn.click(); return postBtn.textContent || postBtn.value; }
        return false;
      });

      if (!submitted) {
        throw new Error('投稿ボタンが見つかりません');
      }
      console.log(`  🔘 ボタンクリック: "${submitted}"`);

      await this._wait(5000);

      // 確認画面がある場合、もう一度送信
      const confirmBtn = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button, input[type="button"]'));
        const confirm = buttons.find(b =>
          (b.textContent || b.value || '').match(/投稿|送信|確定|登録|OK/i)
        );
        if (confirm) { confirm.click(); return confirm.textContent || confirm.value; }
        return false;
      });

      if (confirmBtn) {
        console.log(`  🔘 確認ボタンクリック: "${confirmBtn}"`);
        await this._wait(5000);
      }

      await this._screenshot(page, 'after-post');

      console.log(`  ✅ 投稿完了`);
      return { success: true };
    } catch (e) {
      await this._screenshot(page, 'post-error');
      console.error(`  ❌ 投稿失敗: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  // メイン投稿処理
  async post(account, diary, imagePath) {
    let page = null;
    try {
      const browser = await this._launchBrowser();
      page = await browser.newPage();

      // ログイン
      const loggedIn = await this._login(page, account);
      if (!loggedIn) {
        return { success: false, error: 'ログイン失敗' };
      }

      // 投稿
      const result = await this._postDiary(page, account, diary, imagePath);
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      if (page) await page.close().catch(() => {});
      await this._closeBrowser();
    }
  }

  // テスト: ブラウザ起動だけ確認
  async testBrowser() {
    try {
      const browser = await this._launchBrowser();
      const page = await browser.newPage();
      await page.goto('https://www.cityheaven.net/', { waitUntil: 'networkidle2', timeout: 30000 });
      const title = await page.title();
      await page.close();
      await this._closeBrowser();
      return { success: true, title };
    } catch (e) {
      await this._closeBrowser();
      return { success: false, error: e.message };
    }
  }
}

module.exports = new CityHavenPoster();
