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

      // 1. 投稿タイプ設定
      const postType = options.postType || 'diary';
      await page.evaluate((type) => {
        const sel = type === 'freepost' ? '#freepos' : '#shame';
        const el = document.querySelector(sel);
        if (el) { el.checked = true; el.click(); el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, postType);
      console.log(`  📋 投稿タイプ: ${postType === 'freepost' ? 'フリーポスト' : '写メ日記'}`);
      await this._wait(1000);

      // 2. 公開範囲設定
      const visibility = options.visibility || 'public';
      await page.evaluate((vis) => {
        const el = document.querySelector('#limited_diary_kind');
        if (!el) return;
        const keyword = vis === 'mygirl' ? 'マイガール' : '全公開';
        for (const opt of el.options) {
          if (opt.text.includes(keyword)) { el.value = opt.value; break; }
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, visibility);
      console.log(`  🔒 公開範囲: ${visibility === 'mygirl' ? 'マイガール限定' : '全公開'}`);
      await this._wait(500);

      // 3. タイトル入力
      await page.waitForSelector(SELECTORS.title, { timeout: 10000 });
      await page.type(SELECTORS.title, diary.title, { delay: 30 });
      console.log(`  ✏️ タイトル入力完了: "${diary.title}"`);

      // 4. 本文入力（evaluate内でfocus + value設定 + イベント発火）
      await page.waitForSelector(SELECTORS.body, { timeout: 10000 });
      await page.evaluate((sel, text) => {
        const el = document.querySelector(sel);
        el.focus();
        el.value = text;
        ['focus', 'input', 'change', 'keydown', 'keyup', 'keypress'].forEach(evt => {
          el.dispatchEvent(new Event(evt, { bubbles: true }));
        });
      }, SELECTORS.body, diary.body);
      console.log(`  ✏️ 本文入力完了 - ${diary.body.length}文字`);

      // 5. 画像アップロード
      if (imagePath && fs.existsSync(imagePath)) {
        const fileInput = await page.$(SELECTORS.photo);
        if (fileInput) {
          await fileInput.uploadFile(imagePath);
          console.log(`  📸 画像アップロード完了`);
          await this._wait(3000);
        }
      }

      await this._screenshot(page, 'diary-filled');

      // 6. 送信ボタンをクリック（ページ上の全submitボタンを探す）
      console.log(`  📤 送信ボタンを探しています...`);
      const btnInfo = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"]'));
        return btns.map(b => ({ text: (b.value || b.textContent || '').trim(), tag: b.tagName }));
      });
      console.log(`  🔍 submitボタン: ${JSON.stringify(btnInfo)}`);

      // submitボタンをクリック（「投稿」を含むものを優先、なければ最初のsubmit）
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null),
        page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"]'));
          // 「投稿」を含むボタンを優先
          let target = btns.find(b => (b.value || b.textContent || '').includes('投稿'));
          // なければキャンセル以外の最初のsubmit
          if (!target) target = btns.find(b => !(b.value || b.textContent || '').includes('キャンセル'));
          // それでもなければ最初のsubmit
          if (!target) target = btns[0];
          if (target) { target.click(); return (target.value || target.textContent || '').trim(); }
          return false;
        })
      ]);
      await this._wait(5000);
      await this._screenshot(page, 'after-submit');

      // 7. 遷移後のページを確認
      const afterUrl = page.url();
      const afterText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
      console.log(`  📍 送信後URL: ${afterUrl}`);
      console.log(`  📄 送信後ページ: "${afterText.substring(0, 200)}..."`);

      // 8. 確認画面の場合 → 最終投稿ボタンをクリック
      //    ただし元の投稿ページに戻っただけなら確認画面ではない
      const isConfirmPage = afterUrl !== diaryUrl && (afterText.includes('確認') || afterText.includes('内容'));
      if (isConfirmPage) {
        console.log(`  📋 確認画面を検出 → 最終投稿ボタンを探します`);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null),
          page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button'));
            const target = btns.find(b => {
              const text = (b.value || b.textContent || '').trim();
              return text.match(/投稿|送信|確定|登録|OK/) && !text.includes('キャンセル') && !text.includes('戻る');
            });
            if (target) { target.click(); return true; }
            return false;
          })
        ]);
        await this._wait(5000);
        await this._screenshot(page, 'after-confirm');
      }

      // 9. 最終結果を確認
      const resultUrl = page.url();
      const resultText = await page.evaluate(() => document.body.innerText);
      console.log(`  📍 最終URL: ${resultUrl}`);

      if (resultText.includes('完了') || resultText.includes('成功') || resultText.includes('登録しました') || resultText.includes('投稿しました')) {
        console.log(`  ✅ 投稿完了（完了メッセージ確認）`);
        return { success: true };
      } else if (resultUrl !== diaryUrl) {
        console.log(`  ✅ 投稿完了（ページ遷移確認: ${resultUrl}）`);
        return { success: true };
      } else {
        console.log(`  ⚠️ 投稿結果が不明。スクリーンショットを確認してください。`);
        return { success: true, warning: 'スクリーンショットで結果を確認してください' };
      }
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
