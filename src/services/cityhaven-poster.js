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

      // === フォームの構造を解析 ===
      const formInfo = await page.evaluate(() => {
        const form = document.querySelector('form');
        if (!form) return null;
        const fields = [];
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(el => {
          fields.push({
            tag: el.tagName,
            type: el.type || '',
            name: el.name || '',
            id: el.id || '',
            value: (el.value || '').substring(0, 50),
          });
        });
        return {
          action: form.action || '',
          method: form.method || 'GET',
          enctype: form.enctype || '',
          fieldCount: fields.length,
          fields
        };
      });
      console.log(`  🔍 フォーム情報: action=${formInfo?.action} method=${formInfo?.method} enctype=${formInfo?.enctype}`);
      console.log(`  🔍 フィールド数: ${formInfo?.fieldCount}`);
      formInfo?.fields.forEach(f => {
        console.log(`    [${f.tag}] name="${f.name}" id="${f.id}" type="${f.type}" value="${f.value}"`);
      });

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

      // 3. タイトル入力（page.typeでキーボード入力）
      await page.waitForSelector(SELECTORS.title, { timeout: 10000 });
      await page.evaluate(sel => { const el = document.querySelector(sel); if (el) el.value = ''; }, SELECTORS.title);
      await page.type(SELECTORS.title, diary.title, { delay: 30 });
      console.log(`  ✏️ タイトル入力完了: "${diary.title}"`);

      // 4. 本文入力（execCommandで確実に入力を認識させる）
      await page.waitForSelector(SELECTORS.body, { timeout: 10000 });
      await page.focus(SELECTORS.body);
      await page.evaluate((sel, text) => {
        const el = document.querySelector(sel);
        el.focus();
        el.value = '';
        // execCommandでテキスト挿入（ブラウザネイティブの入力として認識される）
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
        // 念のためvalueも直接設定
        if (!el.value) el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, SELECTORS.body, diary.body);
      // 入力後の確認
      const bodyLen = await page.evaluate(sel => (document.querySelector(sel)?.value || '').length, SELECTORS.body);
      console.log(`  ✏️ 本文入力完了 - ${bodyLen}文字（期待: ${diary.body.length}文字）`);

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

      // === 送信（ボタンクリック方式）===
      // ページ上のsubmitボタンを全てログ出力
      const btnInfo = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"]'));
        return btns.map(b => ({ text: (b.value || b.textContent || '').trim(), tag: b.tagName, name: b.name || '' }));
      });
      console.log(`  🔍 submitボタン: ${JSON.stringify(btnInfo)}`);

      // 投稿を含むボタン → キャンセル以外 → 最初のsubmitの順で探す
      console.log(`  📤 送信中...`);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null),
        page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"]'));
          let target = btns.find(b => (b.value || b.textContent || '').includes('投稿'));
          if (!target) target = btns.find(b => !(b.value || b.textContent || '').includes('キャンセル'));
          if (!target && btns.length > 0) target = btns[0];
          if (target) { target.click(); return true; }
          return false;
        })
      ]);
      await this._wait(5000);
      await this._screenshot(page, 'after-submit');

      // === 遷移後確認 ===
      const afterUrl = page.url();
      const afterText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
      console.log(`  📍 送信後URL: ${afterUrl}`);
      console.log(`  📄 送信後ページ（先頭200文字）: "${afterText.substring(0, 200)}"`);

      // 確認画面がある場合（URLが変わった場合のみ）
      if (afterUrl !== diaryUrl) {
        // 確認画面 or 完了画面
        const hasConfirmBtn = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button'));
          return btns.some(b => {
            const text = (b.value || b.textContent || '').trim();
            return text.match(/投稿|送信|確定|OK/) && !text.includes('キャンセル') && !text.includes('戻る');
          });
        });
        if (hasConfirmBtn) {
          console.log(`  📋 確認画面 → 最終投稿ボタンをクリック`);
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null),
            page.evaluate(() => {
              const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button'));
              const target = btns.find(b => {
                const text = (b.value || b.textContent || '').trim();
                return text.match(/投稿|送信|確定|OK/) && !text.includes('キャンセル') && !text.includes('戻る');
              });
              if (target) target.click();
            })
          ]);
          await this._wait(5000);
          await this._screenshot(page, 'after-confirm');
        }
      }

      // === 最終結果 ===
      const resultUrl = page.url();
      const resultText = await page.evaluate(() => document.body.innerText);
      console.log(`  📍 最終URL: ${resultUrl}`);

      if (resultText.includes('完了') || resultText.includes('成功') || resultText.includes('登録しました') || resultText.includes('投稿しました')) {
        console.log(`  ✅ 投稿完了（完了メッセージ確認）`);
        return { success: true };
      } else if (resultUrl !== diaryUrl) {
        console.log(`  ✅ 投稿完了（ページ遷移: ${resultUrl}）`);
        return { success: true };
      } else {
        console.log(`  ⚠️ 投稿結果が不明。スクリーンショットを確認してください。`);
        return { success: false, error: '投稿結果が不明。after-submitスクリーンショットを確認してください。' };
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
