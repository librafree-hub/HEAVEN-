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

      // JavaScriptのconfirm/alertダイアログを自動でOKする
      page.on('dialog', async (dialog) => {
        console.log(`  💬 ダイアログ検出: "${dialog.message().substring(0, 50)}..." → OK`);
        await dialog.accept();
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

      // 3. タイトル入力（絵文字を除去）
      const cleanTitle = diary.title.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2702}-\u{27B0}\u{200D}\u{20E3}]/gu, '').trim();
      await page.waitForSelector(SELECTORS.title, { timeout: 10000 });
      await page.evaluate((sel, text) => {
        const el = document.querySelector(sel);
        if (el) {
          el.focus();
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, SELECTORS.title, cleanTitle);
      console.log(`  ✏️ タイトル: "${cleanTitle}"`);

      // 4. 本文入力（CKEditor対応 + 絵文字除去）
      const cleanBody = diary.body.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2702}-\u{27B0}\u{200D}\u{20E3}]/gu, '').trim();
      await page.waitForSelector(SELECTORS.body, { timeout: 10000 });

      // CKEditorが使われているかチェックし、適切な方法で入力
      const bodySet = await page.evaluate((sel, text) => {
        // CKEditor経由で入力（最優先）
        if (typeof CKEDITOR !== 'undefined' && CKEDITOR.instances) {
          const editorName = sel.replace('#', '');
          const editor = CKEDITOR.instances[editorName];
          if (editor) {
            editor.setData(text);
            return 'ckeditor';
          }
          // 名前が違う場合、最初のインスタンスを使う
          const keys = Object.keys(CKEDITOR.instances);
          if (keys.length > 0) {
            CKEDITOR.instances[keys[0]].setData(text);
            return 'ckeditor-first';
          }
        }
        // CKEditorなしの場合は直接入力
        const el = document.querySelector(sel);
        if (el) {
          el.focus();
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return 'textarea';
        }
        return 'failed';
      }, SELECTORS.body, cleanBody);
      console.log(`  ✏️ 本文入力方法: ${bodySet}`);
      await this._wait(1000);

      // 入力確認（CKEditorの場合はgetDataで確認）
      const fieldCheck = await page.evaluate((sel) => {
        const title = document.querySelector('#diaryTitle');
        let bodyLen = 0;
        const editorName = sel.replace('#', '');
        if (typeof CKEDITOR !== 'undefined' && CKEDITOR.instances && CKEDITOR.instances[editorName]) {
          bodyLen = CKEDITOR.instances[editorName].getData().length;
        } else {
          const body = document.querySelector(sel);
          bodyLen = body?.value?.length || 0;
        }
        return { titleLen: title?.value?.length || 0, bodyLen };
      }, SELECTORS.body);
      console.log(`  ✏️ 本文: ${fieldCheck.bodyLen}文字（タイトル${fieldCheck.titleLen}文字）`);

      if (fieldCheck.bodyLen === 0) {
        throw new Error('本文の入力に失敗しました（0文字）');
      }

      // 5. 画像アップロード
      if (imagePath && fs.existsSync(imagePath)) {
        const fileInput = await page.$(SELECTORS.photo);
        if (fileInput) {
          await fileInput.uploadFile(imagePath);
          console.log(`  📸 画像アップロード開始`);
          // アップロード完了を待つ（最大15秒）
          // 「アップロード中」テキストが消えるか、サムネイルが表示されるまで待つ
          for (let i = 0; i < 15; i++) {
            await this._wait(1000);
            const uploadStatus = await page.evaluate(() => {
              // サムネイル画像が表示されたら完了
              const thumbs = document.querySelectorAll('img[src*="thumb"], img[src*="upload"], .preview img, .thumbnail img');
              if (thumbs.length > 0) return 'done';
              // テキストでチェック
              const pageText = document.body.innerText;
              if (pageText.includes('アップロード中')) return 'uploading';
              return 'unknown';
            });
            if (uploadStatus === 'done') {
              console.log(`  📸 画像アップロード完了（${i + 1}秒）`);
              break;
            }
            if (uploadStatus !== 'uploading' && i >= 5) {
              // 5秒以上待ってアップロード中でもないなら完了とみなす
              console.log(`  📸 画像アップロード完了（${i + 1}秒、ステータス: ${uploadStatus}）`);
              break;
            }
            if (i === 14) {
              console.log(`  ⚠️ 画像アップロード待機終了（15秒）- 続行します`);
            }
          }
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

  // CityHeaven日記投稿フロー:
  // 1. 「一時保存＆プレビュー」(#previewsbmt) をクリック → AJAXでプレビュー表示（URL変わらない）
  // 2. プレビュー画面の右上に「投稿」ボタンが出現
  // 3. 「投稿」ボタンをクリック → 投稿完了
  async _submitForm(page, diaryUrl) {

    // === STEP 1: 「一時保存＆プレビュー」をクリック ===
    console.log(`  📤 STEP1: 一時保存＆プレビューをクリック...`);

    const previewBtn = await page.$('#previewsbmt');
    if (!previewBtn) {
      console.log(`  ❌ #previewsbmt ボタンが見つかりません`);
      await this._screenshot(page, 'no-preview-btn');
      return { success: false, error: '#previewsbmt ボタンが見つかりません' };
    }

    await previewBtn.scrollIntoView();
    await previewBtn.click();
    console.log(`  📤 #previewsbmt クリック完了`);

    // AJAXなのでnavigationではなく、ネットワークが落ち着くのを待つ
    await this._wait(5000);

    // ページ遷移したかチェック（AJAX or ページ遷移、両方に対応）
    const afterPreviewUrl = page.url();
    console.log(`  📍 プレビュー後URL: ${afterPreviewUrl}`);

    await this._screenshot(page, 'after-preview');

    // プレビュー後のページ内容を確認
    const previewText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
    console.log(`  📄 プレビュー後テキスト(先頭200): ${previewText.substring(0, 200).replace(/\n/g, ' | ')}`);

    // エラーチェック
    if (previewText.match(/エラー|入力してください|文字以上/) && !previewText.includes('日記を投稿する')) {
      console.log(`  ❌ バリデーションエラー`);
      await this._screenshot(page, 'validation-error');
      return { success: false, error: 'フォームのバリデーションエラー' };
    }

    // === STEP 2: 「投稿」ボタンを探してクリック ===
    // ※「確認後右上にある「投稿」ボタンを押して投稿！」とページに書いてある
    console.log(`  📤 STEP2: 投稿ボタンを探してクリック...`);

    // プレビュー後のページ要素をデバッグ出力
    await this._debugPageElements(page);

    // 投稿ボタンを探す（mailto/dcmailtoリンクは完全除外）
    const postClicked = await page.evaluate(() => {
      const allEls = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"], input[type="image"]'));

      // mailtoリンクを完全除外
      const filtered = allEls.filter(el => {
        const href = (el.href || '').toLowerCase();
        if (href.includes('mailto:') || href.includes('dcmailto:')) return false;
        return true;
      });

      // 除外テキスト
      const excludeWords = ['デコメーラー', 'キャンセル', '戻る', '削除', 'メール投稿', '標準メール', 'プレビュー', '一時保存', 'タグ'];
      const isExcluded = (text) => excludeWords.some(w => text.includes(w));

      // 「投稿」ボタンを探す（テキストが短い「投稿」がベスト）
      let target = null;

      // 1. テキストが「投稿」だけのボタン（最優先）
      target = filtered.find(el => {
        const text = (el.value || el.textContent || '').trim();
        return text === '投稿';
      });

      // 2. 「投稿する」「この内容で投稿」等
      if (!target) {
        target = filtered.find(el => {
          const text = (el.value || el.textContent || '').trim();
          return text.match(/^投稿する$|この内容で投稿|日記を投稿$/) && !isExcluded(text);
        });
      }

      // 3. 「投稿」を含むボタン（ただし除外ワード以外）
      if (!target) {
        target = filtered.find(el => {
          const text = (el.value || el.textContent || '').trim();
          return text.includes('投稿') && text.length < 15 && !isExcluded(text);
        });
      }

      // 4. submit系ボタン
      if (!target) {
        target = filtered.find(el => {
          const text = (el.value || el.textContent || '').trim();
          return (el.type === 'submit' || el.type === 'image') && !isExcluded(text);
        });
      }

      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'instant' });
        const tag = target.tagName.toLowerCase();
        const text = (target.value || target.textContent || '').trim().substring(0, 30);
        const href = (target.href || '').substring(0, 50);
        target.click();
        return `<${tag}> "${text}" href="${href}"`;
      }

      return false;
    });

    if (!postClicked) {
      console.log(`  ⚠️ 投稿ボタンが見つかりません。ページ遷移での確認を試みます...`);

      // URLが変わっていれば確認画面かもしれない
      if (afterPreviewUrl !== diaryUrl) {
        const confirmResult = await this._handleConfirmPage(page);
        if (confirmResult !== null) return confirmResult;
      }

      await this._screenshot(page, 'no-post-btn');
      return { success: false, error: '投稿ボタンが見つかりません' };
    }

    console.log(`  📤 投稿ボタンクリック: ${postClicked}`);

    // 投稿後のページ遷移を待つ
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null);
    await this._wait(3000);
    await this._screenshot(page, 'after-post');

    // === STEP 3: 結果判定 ===
    const finalUrl = page.url();
    const finalText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
    console.log(`  📍 投稿後URL: ${finalUrl}`);
    console.log(`  📄 投稿後テキスト(先頭200): ${finalText.substring(0, 200).replace(/\n/g, ' | ')}`);

    // 完了メッセージがあれば成功
    if (finalText.includes('完了') || finalText.includes('成功') ||
        finalText.includes('登録しました') || finalText.includes('投稿しました')) {
      console.log(`  ✅ 投稿完了（完了メッセージ確認）`);
      return { success: true };
    }

    // URLが変わっていれば成功（日記一覧等に遷移）
    if (finalUrl !== diaryUrl) {
      console.log(`  ✅ 投稿完了（ページ遷移確認: ${finalUrl}）`);
      return { success: true };
    }

    // それでもダメなら失敗
    console.log(`  ❌ 投稿失敗（URLも内容も変化なし）`);
    return { success: false, error: '投稿ボタンクリック後もページが変わりません' };
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
