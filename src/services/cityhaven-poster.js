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

      // === ページ上の全フォーム・全入力欄・全ボタンをログ出力 ===
      const pageStructure = await page.evaluate(() => {
        const forms = Array.from(document.querySelectorAll('form')).map((f, i) => ({
          index: i, action: f.action || '', method: f.method || '', enctype: f.enctype || '',
          inputs: Array.from(f.querySelectorAll('input, select, textarea')).map(el => ({
            tag: el.tagName, type: el.type || '', name: el.name || '', id: el.id || ''
          }))
        }));
        const allInputs = Array.from(document.querySelectorAll('input[type="text"], textarea, select')).map(el => ({
          tag: el.tagName, type: el.type || '', name: el.name || '', id: el.id || '',
          placeholder: (el.placeholder || '').substring(0, 30)
        }));
        const allBtns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button, input[type="button"]')).map(b => ({
          tag: b.tagName, type: b.type || '', name: b.name || '', id: b.id || '',
          text: (b.value || b.textContent || '').trim().substring(0, 40)
        }));
        return { formCount: forms.length, forms, inputCount: allInputs.length, allInputs, btnCount: allBtns.length, allBtns };
      });
      console.log(`  🔍 フォーム数: ${pageStructure.formCount}`);
      pageStructure.forms.forEach(f => {
        console.log(`    form[${f.index}] action="${f.action.substring(0, 60)}" method="${f.method}"`);
        f.inputs.forEach(i => console.log(`      ${i.tag} name="${i.name}" id="${i.id}" type="${i.type}"`));
      });
      console.log(`  🔍 入力欄数: ${pageStructure.inputCount}`);
      pageStructure.allInputs.forEach(i => {
        console.log(`    ${i.tag} name="${i.name}" id="${i.id}" type="${i.type}" placeholder="${i.placeholder}"`);
      });
      console.log(`  🔍 ボタン数: ${pageStructure.btnCount}`);
      pageStructure.allBtns.forEach(b => {
        console.log(`    ${b.tag} name="${b.name}" id="${b.id}" type="${b.type}" text="${b.text}"`);
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

      // 3. タイトル入力（evaluate で直接値セット）
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
      console.log(`  ✏️ タイトル入力完了: "${diary.title}"`);

      // 4. 本文入力（evaluate で直接値セット + イベント発火）
      await page.waitForSelector(SELECTORS.body, { timeout: 10000 });
      await page.evaluate((sel, text) => {
        const el = document.querySelector(sel);
        if (el) {
          el.focus();
          el.value = text;
          // ページのJSに入力を認識させるためイベントを発火
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
          el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
        }
      }, SELECTORS.body, diary.body);
      await this._wait(1000);
      // 入力後の確認（タイトルと本文の両方を確認）
      const fieldCheck = await page.evaluate(() => {
        const title = document.querySelector('#diaryTitle');
        const body = document.querySelector('#diary');
        return {
          titleValue: (title?.value || '').substring(0, 50),
          titleLen: title?.value?.length || 0,
          bodyValue: (body?.value || '').substring(0, 50),
          bodyLen: body?.value?.length || 0,
        };
      });
      console.log(`  ✏️ 確認 - タイトル: "${fieldCheck.titleValue}" (${fieldCheck.titleLen}文字)`);
      console.log(`  ✏️ 確認 - 本文: "${fieldCheck.bodyValue}..." (${fieldCheck.bodyLen}文字)`);
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

      // === 入力後にボタン・リンクを再スキャン ===
      const btnsAfter = await page.evaluate(() => {
        // ボタン + aタグも含めてスキャン（投稿リンクがaタグの場合がある）
        const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button, input[type="button"], a'));
        return btns.filter(b => {
          const text = (b.value || b.textContent || '').trim();
          return text.length > 0 && text.length < 30;
        }).map(b => ({
          tag: b.tagName, type: b.type || '', name: b.name || '', id: b.id || '',
          href: b.href || '',
          text: (b.value || b.textContent || '').trim().substring(0, 50)
        }));
      });
      console.log(`  🔍 入力後のボタン・リンク (${btnsAfter.length}個):`);
      btnsAfter.forEach(b => console.log(`    ${b.tag} type="${b.type}" id="${b.id}" text="${b.text}" href="${b.href ? b.href.substring(0, 50) : ''}"`));

      // === 送信 ===
      console.log(`  📤 送信中...`);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null),
        page.evaluate(() => {
          // ボタン + aタグ（投稿リンク）を全てスキャン
          const all = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button, input[type="button"], a'));
          // 1. 「投稿」「送信」「デコメーラー」を含むボタン/リンクを最優先
          let target = all.find(b => (b.value || b.textContent || '').match(/投稿|送信|デコメーラー/));
          // 2. なければ「キャンセル」「削除」「タグ」以外のsubmitボタン
          if (!target) target = all.find(b => {
            const text = (b.value || b.textContent || '').trim();
            return (b.type === 'submit') && !text.includes('キャンセル') && !text.includes('削除') && !text.includes('タグ');
          });
          if (target) { target.click(); return (target.value || target.textContent || '').trim(); }
          return false;
        })
      ]);
      await this._wait(5000);
      await this._screenshot(page, 'after-submit');

      // === 遷移後確認 ===
      const afterUrl = page.url();
      const afterText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
      console.log(`  📍 送信後URL: ${afterUrl}`);
      console.log(`  📄 送信後ページ: "${afterText.substring(0, 200)}"`);

      // 確認画面がある場合（URLが変わった場合のみ）
      if (afterUrl !== diaryUrl) {
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
        console.log(`  ⚠️ 投稿失敗。スクリーンショットを確認してください。`);
        return { success: false, error: '投稿失敗。after-submitスクリーンショットを確認してください。' };
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
