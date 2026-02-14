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
      // ※ラジオボタンがCSSで非表示の場合があるのでJS経由でクリック
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

      // 2. 公開範囲設定（セレクトボックス: #limited_diary_kind）
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

      // 6. ページ上の全クリック可能要素をログ出力（デバッグ用）
      const allButtons = await page.evaluate(() => {
        // ボタン系 + リンク系 + onclick付き要素を全て取得
        const btns = Array.from(document.querySelectorAll(
          'input[type="submit"], button[type="submit"], button, input[type="button"], input[type="image"], ' +
          'a[href], a[onclick], [onclick], [role="button"]'
        ));
        return btns.map(b => ({
          tag: b.tagName,
          type: b.type || '',
          text: (b.textContent || '').trim().substring(0, 60),
          value: (b.value || '').trim().substring(0, 60),
          name: b.name || '',
          id: b.id || '',
          href: (b.href || '').substring(0, 80),
          hasOnclick: !!b.onclick,
          cls: (b.className || '').substring(0, 50),
        }));
      });
      console.log(`  🔍 ページ上のクリック可能要素 (${allButtons.length}個):`);
      allButtons.forEach((b, i) => {
        const extra = b.href ? ` href="${b.href}"` : '';
        const onclick = b.hasOnclick ? ' [onclick]' : '';
        console.log(`    [${i}] <${b.tag}> type="${b.type}" id="${b.id}" class="${b.cls}" value="${b.value}" text="${b.text}"${extra}${onclick}`);
      });

      // 7. 投稿ボタンをクリック（デコメーラー・キャンセル・削除を除外）
      const submitted = await page.evaluate(() => {
        // 広範囲に要素を取得
        const allEls = Array.from(document.querySelectorAll(
          'input[type="submit"], button[type="submit"], button, input[type="button"], input[type="image"], ' +
          'a[href], a[onclick], [onclick], [role="button"]'
        ));
        // 除外: デコメーラー、キャンセル、削除、タグ削除
        const filtered = allEls.filter(b => {
          const text = (b.textContent || b.value || '').trim();
          return !text.includes('デコメーラー') && !text.includes('decomail')
            && !text.includes('キャンセル') && !text.includes('削除');
        });

        // 優先度1: 「確認」を含む要素
        let target = filtered.find(b => {
          const text = (b.textContent || b.value || '').trim();
          return text.match(/^確認|確認する|確認画面/);
        });
        // 優先度2: 「投稿する」「送信」「登録」を含む要素
        if (!target) {
          target = filtered.find(b => {
            const text = (b.textContent || b.value || '').trim();
            return text.match(/投稿する|送信する|登録する|送信|投稿/) && !text.includes('デコメーラー');
          });
        }
        // 優先度3: hrefに「post」「submit」「confirm」を含むリンク
        if (!target) {
          target = filtered.find(b => {
            const href = (b.href || '').toLowerCase();
            return href.match(/post|submit|confirm|diary/);
          });
        }
        // 優先度4: onclickに「submit」「post」を含む要素
        if (!target) {
          target = filtered.find(b => {
            const onclick = b.getAttribute && b.getAttribute('onclick') || '';
            return onclick.match(/submit|post/i);
          });
        }
        // 優先度5: name属性にsubmit/postを含む要素
        if (!target) {
          target = filtered.find(b => b.name && b.name.match(/submit|post|confirm/i));
        }
        // 優先度6: form.submit()を直接実行
        if (!target) {
          const form = document.querySelector('form');
          if (form) {
            form.submit();
            return { text: 'form.submit()', tag: 'FORM', name: 'direct-submit' };
          }
        }

        if (target) {
          target.click();
          return { text: (target.value || target.textContent || '').trim().substring(0, 50), tag: target.tagName, name: target.name || '' };
        }
        return false;
      });
      if (!submitted) throw new Error('投稿ボタンが見つかりません');
      console.log(`  🔘 ボタンクリック: "${submitted.text}" (${submitted.tag} name="${submitted.name}")`);

      await this._wait(5000);
      await this._screenshot(page, 'after-step1');

      // 8. 確認画面 → 最終投稿ボタン（デコメーラー・キャンセル・削除を除外）
      const pageAfterStep1 = await page.evaluate(() => document.body.innerText.substring(0, 500));
      console.log(`  📄 遷移先ページ内容: "${pageAfterStep1.substring(0, 150)}..."`);

      const confirmBtn = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll(
          'input[type="submit"], button[type="submit"], button, input[type="button"], input[type="image"], ' +
          'a[href], a[onclick], [onclick], [role="button"]'
        ));
        const filtered = elements.filter(b => {
          const text = (b.textContent || b.value || '').trim();
          return !text.includes('デコメーラー') && !text.includes('キャンセル') && !text.includes('削除');
        });
        // 「投稿」「送信」「確定」「登録」「OK」を含む要素
        let c = filtered.find(b => (b.textContent || b.value || '').match(/投稿する|送信する|確定|登録する|OK/));
        if (!c) {
          c = filtered.find(b => (b.textContent || b.value || '').match(/投稿|送信|登録/));
        }
        if (c) { c.click(); return (c.textContent || c.value || '').trim().substring(0, 50); }
        // なければform.submit()
        const form = document.querySelector('form');
        if (form) { form.submit(); return 'form.submit()'; }
        return false;
      });
      if (confirmBtn) {
        console.log(`  🔘 確認→投稿ボタンクリック: "${confirmBtn}"`);
        await this._wait(5000);
      } else {
        console.log(`  ℹ️ 確認画面の投稿ボタンなし（1ステップ投稿の可能性）`);
      }

      await this._screenshot(page, 'after-post');

      // 9. 投稿結果を検証
      const resultText = await page.evaluate(() => document.body.innerText);
      const currentUrl = page.url();
      console.log(`  📍 投稿後URL: ${currentUrl}`);

      if (resultText.includes('完了') || resultText.includes('成功') || resultText.includes('登録しました')) {
        console.log(`  ✅ 投稿完了（ページに完了メッセージ確認）`);
        return { success: true };
      } else if (currentUrl !== diaryUrl && !resultText.includes('エラー')) {
        // URLが変わった場合は投稿成功の可能性
        console.log(`  ✅ 投稿完了（ページ遷移を確認）`);
        return { success: true };
      } else {
        console.log(`  ⚠️ 投稿結果が不明です。スクリーンショットを確認してください。`);
        console.log(`  📄 ページ内容（先頭200文字）: ${resultText.substring(0, 200)}`);
        return { success: true, warning: '投稿結果が不明。スクリーンショットで確認してください。' };
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
