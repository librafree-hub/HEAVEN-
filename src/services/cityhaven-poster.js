const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, '../../data/logs');

const SELECTORS = {
  loginId: '#userid',
  loginPw: '#passwd',
  loginBtn: '#loginBtn',
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
        if (el) {
          el.checked = true;
          el.click();
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
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

      // 4. 本文入力 - CKEditor対応
      // CKEditorが使われている場合はCKEditor APIで入力、なければtextareaに直接入力
      await page.waitForSelector(SELECTORS.body, { timeout: 10000 });
      const usedCKEditor = await page.evaluate((text) => {
        // CKEditorインスタンスがあるか確認
        if (typeof CKEDITOR !== 'undefined' && CKEDITOR.instances && CKEDITOR.instances.diary) {
          CKEDITOR.instances.diary.setData(text);
          return true;
        }
        // CKEditorがない場合はtextareaに直接入力
        const el = document.querySelector('#diary');
        if (el) {
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return false;
      }, diary.body);
      console.log(`  ✏️ 本文入力完了 - ${diary.body.length}文字 (CKEditor: ${usedCKEditor ? 'YES' : 'NO'})`);

      // 5. 画像アップロード
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

      // 6. 「一時保存＆プレビュー」ボタンをクリック
      console.log(`  🔘 一時保存＆プレビューを探しています...`);
      const previewClicked = await page.evaluate(() => {
        // 「一時保存＆プレビュー」テキストを持つ要素を探してクリック
        const allElements = Array.from(document.querySelectorAll('*'));
        for (const el of allElements) {
          const text = (el.textContent || '').trim();
          const ownText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join('');
          if (ownText.includes('一時保存') && ownText.includes('プレビュー')) {
            el.click();
            return `<${el.tagName}> "${ownText}"`;
          }
        }
        // storageSave関数があれば呼ぶ
        if (typeof storageSave === 'function') {
          storageSave();
          return 'storageSave()';
        }
        return false;
      });

      if (previewClicked) {
        console.log(`  🔘 プレビュークリック: "${previewClicked}"`);
      } else {
        console.log(`  ⚠️ 「一時保存＆プレビュー」が見つかりません`);
      }

      // プレビュー画面の読み込みを待つ
      await this._wait(5000);
      await this._screenshot(page, 'preview');

      // confirm()ダイアログが出たら自動でOKを押す
      page.on('dialog', async dialog => {
        console.log(`  💬 ダイアログ検出: "${dialog.message().substring(0, 60)}..."`);
        await dialog.accept();
        console.log(`  ✅ ダイアログOK押下`);
      });

      // 7. プレビュー画面で「投稿」ボタンをクリック（右上にあるはず）
      console.log(`  🔘 投稿ボタンを探しています...`);
      const postClicked = await page.evaluate(() => {
        // ページ上の全要素から「投稿」テキストを持つクリッカブル要素を探す
        const allElements = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"], span, div'));
        for (const el of allElements) {
          const ownText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join('');
          // 「投稿」単体のテキストを持つ要素（「投稿方法」や「日記を投稿する」は除外）
          if (ownText === '投稿' || ownText === '投稿する') {
            el.click();
            return `<${el.tagName}> "${ownText}" class="${(el.className || '').toString().substring(0, 50)}"`;
          }
        }
        // submitボタンも探す（デコメ/メール除外）
        const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"]'));
        for (const b of btns) {
          const text = (b.value || b.textContent || '').trim();
          if (text.match(/^投稿/) && !text.includes('デコメ') && !text.includes('メール')) {
            b.click();
            return `submit: "${text}"`;
          }
        }
        return false;
      });

      if (postClicked) {
        console.log(`  🔘 投稿ボタンクリック: "${postClicked}"`);
      } else {
        // 投稿ボタンが見つからない場合、ページ上の全ボタン的要素をデバッグ出力
        const debugBtns = await page.evaluate(() => {
          const elems = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"]'));
          return elems.slice(0, 30).map(el => ({
            tag: el.tagName,
            text: (el.textContent || el.value || '').trim().substring(0, 50),
            id: el.id || '',
            className: (el.className || '').toString().substring(0, 40),
            href: el.getAttribute('href') || ''
          }));
        });
        console.log(`  ⚠️ 投稿ボタンが見つかりません。プレビュー画面の要素一覧:`);
        for (const b of debugBtns) {
          console.log(`    - <${b.tag}> text="${b.text}" id="${b.id}" class="${b.className}" href="${b.href}"`);
        }
      }

      await this._wait(5000);

      await this._screenshot(page, 'after-post');

      // 9. 投稿確認: 一覧ページに移動して確認
      if (account.diaryListUrl) {
        console.log(`  🔍 投稿確認: 一覧ページへ移動...`);
        await page.goto(account.diaryListUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await this._wait(3000);
        await this._screenshot(page, 'diary-list');

        const verified = await page.evaluate((title) => {
          const body = document.body.innerText || '';
          return body.includes(title);
        }, diary.title);

        if (verified) {
          console.log(`  ✅ 投稿確認OK: 一覧にタイトルを確認`);
        } else {
          console.log(`  ⚠️ 投稿確認: 一覧にタイトルが見つかりません`);
        }
      }

      console.log(`  ✅ 投稿完了`);
      return { success: true };
    } catch (e) {
      await this._screenshot(page, 'post-error');
      console.error(`  ❌ 投稿失敗: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

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
