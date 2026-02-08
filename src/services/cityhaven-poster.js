const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, '../../data/logs');

// シティヘブン日記投稿フォームのセレクタ（実際のページから取得済み）
const SELECTORS = {
  // ログインページ
  loginId: '#userid',
  loginPw: '#passwd',
  loginBtn: '#loginBtn',
  // 日記投稿ページ
  title: '#diaryTitle',
  body: '#diary',
  visibility: '#limited_diary_kind',
  postTypeDiary: '#shame',
  postTypeFreepost: '#freepos',
  photo: '#picSelect',
};

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

  async _screenshot(page, name) {
    try {
      if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const filePath = path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.png`);
      await page.screenshot({ path: filePath, fullPage: true });
      console.log(`  📷 スクショ保存: ${filePath}`);
    } catch (e) { /* 無視 */ }
  }

  // ログイン
  async _login(page, account) {
    const loginUrl = account.loginUrl || 'https://spgirl.cityheaven.net/J1Login.php';
    console.log(`  🔑 ログイン中: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await this._wait(2000);

    try {
      await page.waitForSelector(SELECTORS.loginId, { timeout: 10000 });
      await page.type(SELECTORS.loginId, account.loginId, { delay: 50 });
      console.log(`  ✏️ ID入力完了`);

      await page.type(SELECTORS.loginPw, account.loginPassword, { delay: 50 });
      console.log(`  ✏️ パスワード入力完了`);

      await page.click(SELECTORS.loginBtn);
      await this._wait(5000);

      const currentUrl = page.url();
      console.log(`  📍 ログイン後URL: ${currentUrl}`);
      if (currentUrl.includes('Login')) {
        throw new Error('ログイン失敗 - ID/パスワードを確認');
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
  async _postDiary(page, account, diary, imagePath, options = {}) {
    try {
      const diaryUrl = account.diaryUrl || 'https://spgirl.cityheaven.net/J4KeitaiDiaryPost.php';
      console.log(`  📝 日記投稿ページへ移動: ${diaryUrl}`);
      await page.goto(diaryUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._wait(3000);

      // 1. 投稿タイプ設定（ラジオボタン: #shame=写メ日記, #freepos=フリーポスト）
      const postType = options.postType || 'diary';
      if (postType === 'freepost') {
        await page.click(SELECTORS.postTypeFreepost);
        console.log(`  📋 投稿タイプ: フリーポスト`);
      } else {
        await page.click(SELECTORS.postTypeDiary);
        console.log(`  📋 投稿タイプ: 写メ日記`);
      }
      await this._wait(1000);

      // 2. 公開範囲設定（セレクトボックス: #limited_diary_kind）
      const visibility = options.visibility || 'public';
      if (visibility === 'mygirl') {
        await page.select(SELECTORS.visibility, 'マイガール限定');
        // valueがテキストと異なる場合の対応
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          for (const opt of el.options) {
            if (opt.text.includes('マイガール')) { el.value = opt.value; break; }
          }
          el.dispatchEvent(new Event('change'));
        }, SELECTORS.visibility);
        console.log(`  🔒 公開範囲: マイガール限定`);
      } else {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          for (const opt of el.options) {
            if (opt.text.includes('全公開')) { el.value = opt.value; break; }
          }
          el.dispatchEvent(new Event('change'));
        }, SELECTORS.visibility);
        console.log(`  🔒 公開範囲: 全公開`);
      }
      await this._wait(500);

      // 3. タイトル入力（#diaryTitle）
      await page.waitForSelector(SELECTORS.title, { timeout: 10000 });
      await page.type(SELECTORS.title, diary.title, { delay: 30 });
      console.log(`  ✏️ タイトル入力完了: "${diary.title}"`);

      // 4. 本文入力（#diary textarea - 一括入力で高速化）
      await page.waitForSelector(SELECTORS.body, { timeout: 10000 });
      await page.evaluate((sel, text) => {
        const el = document.querySelector(sel);
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, SELECTORS.body, diary.body);
      console.log(`  ✏️ 本文入力完了 - ${diary.body.length}文字`);

      // 5. 画像アップロード（#picSelect）
      if (imagePath && fs.existsSync(imagePath)) {
        const fileInput = await page.$(SELECTORS.photo);
        if (fileInput) {
          await fileInput.uploadFile(imagePath);
          console.log(`  📸 画像アップロード完了`);
          await this._wait(3000);
        } else {
          console.log(`  ⚠️ 画像アップロード欄が見つかりません`);
        }
      }

      await this._screenshot(page, 'diary-filled');

      // 6. 投稿ボタンをクリック
      const submitted = await page.evaluate(() => {
        const btn = document.querySelector('input[type="submit"], button[type="submit"]');
        if (btn) { btn.click(); return btn.value || btn.textContent || 'submit'; }
        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], a'));
        const postBtn = buttons.find(b => (b.textContent || b.value || '').match(/投稿|送信|確認|登録/));
        if (postBtn) { postBtn.click(); return postBtn.textContent || postBtn.value; }
        return false;
      });
      if (!submitted) throw new Error('投稿ボタンが見つかりません');
      console.log(`  🔘 ボタンクリック: "${submitted}"`);

      await this._wait(5000);

      // 7. 確認画面がある場合
      const confirmBtn = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button, input[type="button"]'));
        const c = buttons.find(b => (b.textContent || b.value || '').match(/投稿|送信|確定|登録|OK/));
        if (c) { c.click(); return c.textContent || c.value; }
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
  async post(account, diary, imagePath, options = {}) {
    let page = null;
    try {
      const browser = await this._launchBrowser();
      page = await browser.newPage();

      const loggedIn = await this._login(page, account);
      if (!loggedIn) return { success: false, error: 'ログイン失敗' };

      const result = await this._postDiary(page, account, diary, imagePath, options);
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      if (page) await page.close().catch(() => {});
      await this._closeBrowser();
    }
  }

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
