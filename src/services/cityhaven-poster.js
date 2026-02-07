const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

class CityHavenPoster {
  constructor() {
    this.browser = null;
  }

  async _launchBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1280, height: 900 },
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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

  // シティヘブンにログイン
  async _login(page, account) {
    const loginUrl = account.loginUrl || 'https://d-heaven.net/';

    console.log(`  🔑 ログイン中: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await this._wait(2000);

    // ログインフォームに入力
    // ※セレクタはシティヘブンの実際のフォームに合わせて調整が必要
    try {
      // ID入力
      const idSelector = account.selectors?.idInput || 'input[name="login_id"]';
      await page.waitForSelector(idSelector, { timeout: 10000 });
      await page.type(idSelector, account.loginId, { delay: 50 });

      // パスワード入力
      const pwSelector = account.selectors?.pwInput || 'input[name="login_pw"]';
      await page.type(pwSelector, account.loginPassword, { delay: 50 });

      // ログインボタン
      const btnSelector = account.selectors?.loginBtn || 'input[type="submit"], button[type="submit"]';
      await page.click(btnSelector);
      await this._wait(3000);

      console.log(`  ✅ ログイン完了`);
      return true;
    } catch (e) {
      console.error(`  ❌ ログイン失敗: ${e.message}`);
      return false;
    }
  }

  // 日記を投稿
  async _postDiary(page, account, diary, imagePath) {
    try {
      // 日記投稿ページへ移動
      const diaryUrl = account.diaryUrl || 'https://d-heaven.net/diary/new';
      console.log(`  📝 日記投稿ページへ移動: ${diaryUrl}`);
      await page.goto(diaryUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._wait(2000);

      // タイトル入力
      const titleSelector = account.selectors?.titleInput || 'input[name="title"], input[name="subject"]';
      await page.waitForSelector(titleSelector, { timeout: 10000 });
      await page.type(titleSelector, diary.title, { delay: 30 });

      // 本文入力
      const bodySelector = account.selectors?.bodyInput || 'textarea[name="body"], textarea[name="comment"]';
      await page.waitForSelector(bodySelector, { timeout: 10000 });
      await page.type(bodySelector, diary.body, { delay: 10 });

      // 画像アップロード
      if (imagePath && fs.existsSync(imagePath)) {
        const fileSelector = account.selectors?.fileInput || 'input[type="file"]';
        const fileInput = await page.$(fileSelector);
        if (fileInput) {
          await fileInput.uploadFile(imagePath);
          console.log(`  📸 画像アップロード完了`);
          await this._wait(2000);
        }
      }

      // 投稿ボタン
      const submitSelector = account.selectors?.submitBtn || 'input[type="submit"], button[type="submit"]';
      await page.click(submitSelector);
      await this._wait(5000);

      console.log(`  ✅ 投稿完了`);
      return { success: true };
    } catch (e) {
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
