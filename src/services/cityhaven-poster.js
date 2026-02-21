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

  // ページ上の全ボタン・送信要素をデバッグ出力
  async _debugPageElements(page) {
    const elements = await page.evaluate(() => {
      const results = [];
      // すべてのinput, button, aタグを収集
      const selectors = 'input, button, a[href], [onclick], [role="button"]';
      document.querySelectorAll(selectors).forEach(el => {
        const tag = el.tagName.toLowerCase();
        const type = el.type || '';
        const text = (el.value || el.textContent || '').trim().substring(0, 50);
        const name = el.name || '';
        const id = el.id || '';
        const href = el.href || '';
        const onclick = el.getAttribute('onclick') || '';
        const classes = el.className || '';
        const display = getComputedStyle(el).display;
        if (display === 'none') return; // 非表示は除外
        if (tag === 'input' && ['text', 'hidden', 'password', 'radio', 'checkbox', 'file', 'tel', 'email'].includes(type)) return;
        results.push({ tag, type, text, name, id, href: href.substring(0, 80), onclick: onclick.substring(0, 80), classes: String(classes).substring(0, 50) });
      });
      return results;
    });
    console.log(`  🔍 ページ上のボタン・リンク一覧 (${elements.length}件):`);
    elements.forEach((el, i) => {
      console.log(`    [${i}] <${el.tag}> type="${el.type}" text="${el.text}" name="${el.name}" id="${el.id}" onclick="${el.onclick}" href="${el.href}"`);
    });
    return elements;
  }

  // フォーム送信（リトライ付き）
  async _submitForm(page, diaryUrl) {
    const MAX_SUBMIT_RETRIES = 2;

    // まず全要素をデバッグ出力（何がページにあるか把握）
    const allElements = await this._debugPageElements(page);

    for (let attempt = 0; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`  🔄 送信リトライ ${attempt}/${MAX_SUBMIT_RETRIES}...`);
        await this._dismissOverlays(page);
        await this._wait(2000);
      }

      console.log(`  📤 送信中...`);

      // 送信ボタンを探してスクロール→クリック
      const clicked = await page.evaluate(() => {
        // ★ CityHeaven専用: 「一時保存＆プレビュー」ボタン（id="previewsbmt"）を最優先
        let target = document.querySelector('#previewsbmt');
        if (target) {
          target.scrollIntoView({ block: 'center', behavior: 'instant' });
          target.click();
          return `<${target.tagName.toLowerCase()}> "#previewsbmt: ${(target.textContent||'').trim().substring(0, 30)}"`;
        }

        // 広い範囲でボタンを検索（input[type="image"]も含む）
        const buttons = Array.from(document.querySelectorAll(
          'input[type="submit"], button[type="submit"], button, input[type="button"], input[type="image"]'
        ));

        // 除外キーワード
        const excludeWords = ['デコメーラー', 'キャンセル', '戻る', '削除', 'タグ追加', 'タグ検索'];
        const isExcluded = (text) => excludeWords.some(w => text.includes(w));

        // 1. 「確認」「投稿」「送信」「プレビュー」を含むボタンを優先
        target = buttons.find(b => {
          const text = (b.value || b.textContent || '').trim();
          return text.match(/確認|投稿|送信|登録|プレビュー|一時保存/) && !isExcluded(text);
        });

        // 2. なければ input[type="submit"] か input[type="image"]
        if (!target) {
          target = buttons.find(b => {
            const text = (b.value || b.textContent || '').trim();
            return (b.type === 'submit' || b.type === 'image') && !isExcluded(text);
          });
        }

        // 3. なければ onclick属性を持つボタン的要素
        if (!target) {
          const clickables = Array.from(document.querySelectorAll('[onclick]'));
          target = clickables.find(el => {
            const text = (el.value || el.textContent || '').trim();
            return text.match(/確認|投稿|送信|登録|プレビュー|一時保存/) && !isExcluded(text);
          });
        }

        // 4. aタグも探す（プレビュー・投稿・確認のテキストを持つもの）
        if (!target) {
          const links = Array.from(document.querySelectorAll('a'));
          target = links.find(a => {
            const text = (a.textContent || '').trim();
            const href = a.href || '';
            return text.match(/確認|投稿する|送信する|プレビュー|一時保存/) && !isExcluded(text)
              && (href.includes('javascript:') || href === '#' || href.includes('submit'));
          });
        }

        if (target) {
          target.scrollIntoView({ block: 'center', behavior: 'instant' });
          target.click();
          const tag = target.tagName.toLowerCase();
          const text = (target.value || target.textContent || '').trim().substring(0, 30);
          return `<${tag}> "${text}"`;
        }

        return false;
      });

      if (!clicked) {
        console.log(`  ⚠️ 送信ボタンが見つかりません`);
        await this._screenshot(page, 'no-submit-btn');
        continue;
      }
      console.log(`  📤 クリック: ${clicked}`);

      // ページ遷移を待つ
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null);
      await this._wait(3000);
      await this._screenshot(page, 'after-submit');

      // 遷移後確認
      const afterUrl = page.url();
      const afterText = await page.evaluate(() => document.body.innerText.substring(0, 1500));
      console.log(`  📍 送信後URL: ${afterUrl}`);
      console.log(`  📄 ページ冒頭: ${afterText.substring(0, 200).replace(/\n/g, ' | ')}`);

      // プレビューボタンはJavaScriptで動くので、ページ遷移ではなくコンテンツ変更の可能性もある
      // 少し長めに待つ
      const hasError = afterText.match(/エラー|入力してください|必須/) && !afterText.includes('日記を投稿する');

      // URLが変わった場合 → 確認/プレビュー画面に遷移した
      if (afterUrl !== diaryUrl && !hasError) {
        console.log(`  📋 プレビュー/確認画面に遷移`);
        await this._debugPageElements(page);
        const confirmResult = await this._handleConfirmPage(page);
        if (confirmResult !== null) return confirmResult;

        // 確認画面の処理後
        const resultUrl = page.url();
        const resultText = await page.evaluate(() => document.body.innerText);
        if (resultText.includes('完了') || resultText.includes('成功') ||
            resultText.includes('登録しました') || resultText.includes('投稿しました')) {
          console.log(`  ✅ 投稿完了（完了メッセージ確認）`);
          return { success: true };
        }
        if (resultUrl !== diaryUrl) {
          console.log(`  ✅ 投稿完了（ページ遷移確認: ${resultUrl}）`);
          return { success: true };
        }
      }

      // URLが変わってないが、ページ内容が変わった可能性（AJAXプレビュー等）
      // プレビュー後に「投稿する」系のボタンが出現するかチェック
      if (afterUrl === diaryUrl) {
        const postBtnFound = await page.evaluate(() => {
          // プレビュー後に「投稿する」ボタンが出現するか
          const allEls = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"]'));
          return allEls.find(el => {
            const text = (el.value || el.textContent || '').trim();
            return text.match(/投稿する|この内容で投稿|日記を投稿/) && !text.includes('デコメーラー');
          }) ? true : false;
        });

        if (postBtnFound) {
          console.log(`  📋 プレビュー内に「投稿する」ボタン発見 → クリック`);
          await page.evaluate(() => {
            const allEls = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"]'));
            const btn = allEls.find(el => {
              const text = (el.value || el.textContent || '').trim();
              return text.match(/投稿する|この内容で投稿|日記を投稿/) && !text.includes('デコメーラー');
            });
            if (btn) {
              btn.scrollIntoView({ block: 'center', behavior: 'instant' });
              btn.click();
            }
          });
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null);
          await this._wait(3000);
          await this._screenshot(page, 'after-final-post');

          const finalUrl = page.url();
          const finalText = await page.evaluate(() => document.body.innerText);
          console.log(`  📍 最終URL: ${finalUrl}`);

          if (finalText.includes('完了') || finalText.includes('成功') ||
              finalText.includes('登録しました') || finalText.includes('投稿しました') ||
              finalUrl !== diaryUrl) {
            console.log(`  ✅ 投稿完了！`);
            return { success: true };
          }
        }
      }

      // エラーか送信失敗
      if (hasError) {
        console.log(`  ⚠️ エラーメッセージ検出`);
      } else {
        console.log(`  ⚠️ 送信失敗の可能性`);
        // デバッグ: 現在のページ要素を再出力
        await this._debugPageElements(page);
      }

      // 失敗 - リトライ
      if (attempt < MAX_SUBMIT_RETRIES) {
        console.log(`  ⚠️ リトライします...`);
        const resultUrl = page.url();
        if (resultUrl !== diaryUrl) {
          await page.goto(diaryUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null);
          await this._wait(2000);
        }
      }
    }

    // 全リトライ失敗
    console.log(`  ❌ 投稿失敗（リトライ上限）`);
    return { success: false, error: `送信ボタンが見つからないか、フォーム送信が失敗しました` };
  }

  // 確認画面の処理
  async _handleConfirmPage(page) {
    // button, input, aタグ全てから投稿ボタンを探す
    const hasConfirmBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button, a, input[type="button"]'));
      return btns.some(b => {
        const text = (b.value || b.textContent || '').trim();
        return text.match(/投稿する|送信する|確定|この内容で投稿|日記を投稿/) && !text.includes('キャンセル') && !text.includes('戻る') && !text.includes('デコメーラー');
      });
    });

    if (!hasConfirmBtn) return null;

    console.log(`  📋 確認画面 → 最終投稿ボタンをクリック`);
    const clickedText = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button, a, input[type="button"]'));
      const target = btns.find(b => {
        const text = (b.value || b.textContent || '').trim();
        return text.match(/投稿する|送信する|確定|この内容で投稿|日記を投稿/) && !text.includes('キャンセル') && !text.includes('戻る') && !text.includes('デコメーラー');
      });
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'instant' });
        target.click();
        return (target.value || target.textContent || '').trim().substring(0, 30);
      }
      return null;
    });
    console.log(`  📤 確認画面クリック: "${clickedText}"`);

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
