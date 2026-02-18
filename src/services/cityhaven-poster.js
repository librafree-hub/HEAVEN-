const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, '../../data/logs');
const IS_CLOUD = process.env.HEADLESS === 'true';

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
        headless: IS_CLOUD ? 'new' : false,
        defaultViewport: { width: 1280, height: 900 },
        args: [
          '--no-sandbox', '--disable-setuid-sandbox', '--lang=ja',
          ...(IS_CLOUD ? ['--disable-gpu', '--disable-dev-shm-usage'] : [])
        ],
        ...(process.env.PUPPETEER_EXECUTABLE_PATH
          ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
          : {})
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

  // ポップアップ・通知・オーバーレイを閉じる
  async _dismissOverlays(page) {
    try {
      await page.evaluate(() => {
        // 閉じるボタン（×ボタン、closeボタン等）を全て探してクリック
        const closeSelectors = [
          '.modal .close', '.modal-close', '.popup-close', '.notification-close',
          '[class*="close"]', '[class*="dismiss"]',
          '.overlay .close', '[aria-label="閉じる"]', '[aria-label="Close"]'
        ];
        for (const sel of closeSelectors) {
          document.querySelectorAll(sel).forEach(el => {
            try { el.click(); } catch (e) { /* 無視 */ }
          });
        }
        // モーダル・オーバーレイを非表示にする
        document.querySelectorAll('.modal, .overlay, .popup, [class*="notification"]').forEach(el => {
          if (el.style.display !== 'none' && getComputedStyle(el).position === 'fixed') {
            el.style.display = 'none';
          }
        });
      });
      await this._wait(500);
    } catch (e) { /* 無視 */ }
  }

  // ログイン
  async _login(page, account) {
    const loginUrl = account.loginUrl || 'https://spgirl.cityheaven.net/J1Login.php';
    console.log(`  🔑 ログイン中: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await this._wait(2000);
    await this._dismissOverlays(page);

    try {
      await page.waitForSelector(SELECTORS.loginId, { timeout: 10000 });
      await page.type(SELECTORS.loginId, account.loginId, { delay: 50 });
      await page.type(SELECTORS.loginPw, account.loginPassword, { delay: 50 });
      console.log(`  ✏️ ID/PW入力完了`);

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
      await this._dismissOverlays(page);

      // === フォームにデータを設定 ===

      // 1. 投稿タイプ
      const postType = options.postType || 'diary';
      await page.evaluate((type) => {
        const sel = type === 'freepost' ? '#freepos' : '#shame';
        const el = document.querySelector(sel);
        if (el) { el.checked = true; el.click(); el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, postType);
      console.log(`  📋 投稿タイプ: ${postType === 'freepost' ? 'フリーポスト' : '写メ日記'}`);
      await this._wait(1000);

      // 2. 公開範囲
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
      await page.evaluate((sel, text) => {
        const el = document.querySelector(sel);
        if (el) {
          el.focus();
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, SELECTORS.title, diary.title);
      console.log(`  ✏️ タイトル: "${diary.title}"`);

      // 4. 本文入力
      await page.waitForSelector(SELECTORS.body, { timeout: 10000 });
      await page.evaluate((sel, text) => {
        const el = document.querySelector(sel);
        if (el) {
          el.focus();
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
          el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
        }
      }, SELECTORS.body, diary.body);
      await this._wait(1000);

      // 入力確認
      const fieldCheck = await page.evaluate(() => {
        const title = document.querySelector('#diaryTitle');
        const body = document.querySelector('#diary');
        return { titleLen: title?.value?.length || 0, bodyLen: body?.value?.length || 0 };
      });
      console.log(`  ✏️ 本文: ${fieldCheck.bodyLen}文字（タイトル${fieldCheck.titleLen}文字）`);

      if (fieldCheck.bodyLen === 0) {
        throw new Error('本文の入力に失敗しました（0文字）');
      }

      // 5. 画像アップロード
      if (imagePath && fs.existsSync(imagePath)) {
        const fileInput = await page.$(SELECTORS.photo);
        if (fileInput) {
          await fileInput.uploadFile(imagePath);
          console.log(`  📸 画像アップロード完了`);
          await this._wait(3000);
        }
      }

      await this._dismissOverlays(page);
      await this._screenshot(page, 'diary-filled');

      // === 送信（リトライあり） ===
      const submitResult = await this._submitForm(page, diaryUrl);
      return submitResult;

    } catch (e) {
      await this._screenshot(page, 'post-error');
      console.error(`  ❌ 投稿失敗: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  // フォーム送信（リトライ付き）
  async _submitForm(page, diaryUrl) {
    const MAX_SUBMIT_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`  🔄 送信リトライ ${attempt}/${MAX_SUBMIT_RETRIES}...`);
        await this._dismissOverlays(page);
        await this._wait(2000);
      }

      console.log(`  📤 送信中...`);

      // 送信ボタンを探してスクロール→クリック
      const clicked = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button, input[type="button"], a'));

        // 「投稿」「送信」「デコメーラー」を含む要素を優先
        let target = all.find(b => {
          const text = (b.value || b.textContent || '').trim();
          return text.match(/投稿|送信|デコメーラー/) && !text.includes('キャンセル') && !text.includes('戻る');
        });

        // なければsubmitボタン（キャンセル等除外）
        if (!target) {
          target = all.find(b => {
            const text = (b.value || b.textContent || '').trim();
            return (b.type === 'submit') && !text.includes('キャンセル') && !text.includes('削除') && !text.includes('タグ');
          });
        }

        if (target) {
          // スクロールして表示してからクリック
          target.scrollIntoView({ block: 'center', behavior: 'instant' });
          target.click();
          return (target.value || target.textContent || '').trim().substring(0, 30);
        }

        // フォームを直接submitする最終手段
        const form = document.querySelector('form');
        if (form) {
          form.submit();
          return 'form.submit()';
        }
        return false;
      });

      if (!clicked) {
        console.log(`  ⚠️ 送信ボタンが見つかりません`);
        await this._screenshot(page, 'no-submit-btn');
        continue;
      }
      console.log(`  📤 クリック: "${clicked}"`);

      // ページ遷移を待つ
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null);
      await this._wait(3000);
      await this._screenshot(page, 'after-submit');

      // 遷移後確認
      const afterUrl = page.url();
      const afterText = await page.evaluate(() => document.body.innerText.substring(0, 1500));
      console.log(`  📍 送信後URL: ${afterUrl}`);

      // エラーメッセージがあるか確認
      const hasError = afterText.includes('エラー') && !afterText.includes('日記を投稿する');

      // 確認画面がある場合
      if (afterUrl !== diaryUrl && !hasError) {
        const confirmResult = await this._handleConfirmPage(page);
        if (confirmResult !== null) return confirmResult;
      }

      // 最終結果判定
      const resultUrl = page.url();
      const resultText = await page.evaluate(() => document.body.innerText);

      // 成功パターン
      if (resultText.includes('完了') || resultText.includes('成功') ||
          resultText.includes('登録しました') || resultText.includes('投稿しました') ||
          resultText.includes('日記一覧')) {
        console.log(`  ✅ 投稿完了`);
        return { success: true };
      }

      // URL変更＝遷移した＝成功の可能性が高い
      if (resultUrl !== diaryUrl && !hasError) {
        console.log(`  ✅ 投稿完了（ページ遷移確認）`);
        return { success: true };
      }

      // 失敗 - リトライする
      if (attempt < MAX_SUBMIT_RETRIES) {
        console.log(`  ⚠️ 送信失敗の可能性。リトライします...`);
        // 元のページに戻る
        if (resultUrl !== diaryUrl) {
          await page.goto(diaryUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null);
          await this._wait(2000);
        }
      }
    }

    // 全リトライ失敗
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 300));
    console.log(`  ❌ 投稿失敗（リトライ上限）`);
    return { success: false, error: `ページにエラー表示: ${pageText.substring(0, 200)}` };
  }

  // 確認画面の処理
  async _handleConfirmPage(page) {
    const hasConfirmBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button'));
      return btns.some(b => {
        const text = (b.value || b.textContent || '').trim();
        return text.match(/投稿|送信|確定|OK/) && !text.includes('キャンセル') && !text.includes('戻る');
      });
    });

    if (!hasConfirmBtn) return null;

    console.log(`  📋 確認画面 → 最終投稿ボタンをクリック`);
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button'));
      const target = btns.find(b => {
        const text = (b.value || b.textContent || '').trim();
        return text.match(/投稿|送信|確定|OK/) && !text.includes('キャンセル') && !text.includes('戻る');
      });
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'instant' });
        target.click();
      }
    });

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null);
    await this._wait(3000);
    await this._screenshot(page, 'after-confirm');

    const resultText = await page.evaluate(() => document.body.innerText);
    if (resultText.includes('完了') || resultText.includes('成功') ||
        resultText.includes('登録しました') || resultText.includes('投稿しました') ||
        resultText.includes('日記一覧')) {
      console.log(`  ✅ 投稿完了`);
      return { success: true };
    }

    // 確認画面を通過したなら成功とみなす
    console.log(`  ✅ 投稿完了（確認画面通過）`);
    return { success: true };
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
