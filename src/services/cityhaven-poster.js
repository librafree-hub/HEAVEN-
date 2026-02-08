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

      // 6. ページ構造を徹底的に調査
      const pageInfo = await page.evaluate(() => {
        // 全form要素
        const forms = Array.from(document.querySelectorAll('form'));
        const formInfo = forms.map((f, i) => ({
          index: i,
          id: f.id || '',
          name: f.name || '',
          action: f.action || '',
          method: f.method || '',
          hasSubmit: !!f.querySelector('input[type="submit"], button[type="submit"]'),
          submitValue: f.querySelector('input[type="submit"]') ? f.querySelector('input[type="submit"]').value : '',
          childCount: f.elements.length
        }));

        // 全要素から投稿関連キーワードを探す（テキストに「投稿」「確認」「送信」「下書き」「プレビュー」を含む要素）
        const allElements = Array.from(document.querySelectorAll('*'));
        const postRelated = [];
        for (const el of allElements) {
          const ownText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join('');
          if (ownText && ownText.match(/投稿|確認|送信|下書き|プレビュー|保存|登録/) && !ownText.includes('デコメ') && !ownText.includes('標準メール')) {
            postRelated.push({
              tag: el.tagName,
              id: el.id || '',
              className: (el.className || '').toString().substring(0, 60),
              text: ownText.substring(0, 60),
              onclick: el.getAttribute('onclick') ? el.getAttribute('onclick').substring(0, 100) : '',
              href: el.getAttribute('href') || ''
            });
          }
        }

        // グローバルJavaScript関数名を探す
        const globalFuncs = [];
        for (const key of Object.keys(window)) {
          if (typeof window[key] === 'function' && key.match(/submit|post|diary|save|confirm|send/i)) {
            globalFuncs.push(key);
          }
        }

        return { forms: formInfo, postRelated, globalFuncs };
      });

      console.log(`  🔍 フォーム: ${pageInfo.forms.length}個`);
      for (const f of pageInfo.forms) {
        console.log(`    - form#${f.id} name="${f.name}" action="${f.action}" method="${f.method}" submit=${f.hasSubmit}(${f.submitValue}) elements=${f.childCount}`);
      }
      console.log(`  🔍 投稿関連要素: ${pageInfo.postRelated.length}個`);
      for (const p of pageInfo.postRelated) {
        console.log(`    - <${p.tag}> id="${p.id}" class="${p.className}" text="${p.text}" onclick="${p.onclick}" href="${p.href}"`);
      }
      console.log(`  🔍 関連JS関数: ${pageInfo.globalFuncs.join(', ') || 'なし'}`);

      // 7. 投稿を実行
      const submitted = await page.evaluate(() => {
        // A: グローバル関数に submit/post 系があればそれを呼ぶ
        for (const key of Object.keys(window)) {
          if (typeof window[key] === 'function') {
            // diarySubmit, submitDiary, doPost などを探す
            if (key.match(/^(submit|diary.*submit|submit.*diary|doPost|postDiary|doSubmit|formSubmit)$/i)) {
              window[key]();
              return `globalFunc: ${key}()`;
            }
          }
        }

        // B: 投稿/確認テキストを持つ要素をクリック（デコメ/標準メール除外）
        const allElements = Array.from(document.querySelectorAll('*'));
        for (const el of allElements) {
          const ownText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join('');
          if (ownText && ownText.match(/^(確認|投稿する|送信|投稿確認|確認画面)$/) && !ownText.includes('デコメ') && !ownText.includes('標準メール')) {
            el.click();
            return `element: <${el.tagName}> "${ownText}"`;
          }
        }

        // C: form[name] or form[id] でsubmitを試みる
        const forms = Array.from(document.querySelectorAll('form'));
        for (const f of forms) {
          const action = (f.action || '').toLowerCase();
          const name = (f.name || '').toLowerCase();
          if (action.includes('diary') || name.includes('diary') || name.includes('post')) {
            f.submit();
            return `formSubmit: ${f.name || f.id || f.action}`;
          }
        }

        // D: diary関連のフォームを見つけて送信
        const diaryEl = document.querySelector('#diary');
        if (diaryEl) {
          // #diary の祖先にformがなくても、同じ名前空間のformがあるかもしれない
          const allForms = Array.from(document.querySelectorAll('form'));
          for (const f of allForms) {
            if (f.querySelector('#diaryTitle') || f.querySelector('#diary') || f.querySelector('#picSelect')) {
              f.submit();
              return `relatedForm: ${f.name || f.id || f.action}`;
            }
          }
        }

        return false;
      });

      if (submitted) {
        console.log(`  🔘 投稿実行: "${submitted}"`);
      } else {
        console.log(`  ⚠️ 自動投稿できませんでした。手動操作が必要な可能性があります。`);
      }

      await this._wait(5000);

      // 8. 確認画面がある場合
      const confirmBtn = await page.evaluate(() => {
        const allElements = Array.from(document.querySelectorAll('*'));
        for (const el of allElements) {
          const ownText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join('');
          if (ownText && ownText.match(/^(投稿する|投稿|送信|確定|登録|OK)$/) && !ownText.includes('デコメ') && !ownText.includes('メール')) {
            el.click();
            return `<${el.tagName}> "${ownText}"`;
          }
        }
        // submitボタンも探す
        const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"]'));
        const filtered = btns.filter(b => !(b.textContent || b.value || '').includes('デコメ') && !(b.textContent || b.value || '').includes('メール'));
        if (filtered.length > 0) {
          filtered[0].click();
          return `submit: ${filtered[0].value || filtered[0].textContent}`;
        }
        return false;
      });
      if (confirmBtn) {
        console.log(`  🔘 確認ボタンクリック: "${confirmBtn}"`);
        await this._wait(5000);
      }

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
