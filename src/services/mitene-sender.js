const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, '../../data/logs');

class MiteneSender {
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

  // ステップ1: 姫デコログイン
  async _login(page, account) {
    const loginUrl = account.loginUrl || 'https://spgirl.cityheaven.net/J1Login.php';
    console.log(`  🔑 姫デコログイン中: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await this._wait(2000);

    try {
      await page.waitForSelector('#userid', { timeout: 10000 });
      await page.type('#userid', account.loginId, { delay: 50 });
      await page.type('#passwd', account.loginPassword, { delay: 50 });
      console.log(`  ✏️ ID/パスワード入力完了`);

      await page.click('#loginBtn');
      await this._wait(5000);

      const currentUrl = page.url();
      console.log(`  📍 ログイン後URL: ${currentUrl}`);
      if (currentUrl.includes('Login')) {
        throw new Error('ログイン失敗 - ID/パスワードを確認');
      }
      console.log(`  ✅ ログイン完了`);
      return true;
    } catch (e) {
      await this._screenshot(page, 'mitene-login-error');
      console.error(`  ❌ ログイン失敗: ${e.message}`);
      return false;
    }
  }

  // ステップ2: トップページで「キテネできる会員を探す」「ミテネできる会員を探す」を押す
  async _findMembers(page) {
    console.log(`  🔍 トップページで「キテネ/ミテネできる会員を探す」を検索中...`);
    await this._screenshot(page, 'mitene-top-page');

    // まずリンクやボタンのテキストで探す
    const clicked = await page.evaluate(() => {
      const elements = [...document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')];
      const target = elements.find(el => {
        const text = (el.textContent || el.value || '').trim();
        return text.includes('キテネできる会員を探す') ||
               text.includes('ミテネできる会員を探す') ||
               text.includes('キテネできる会員') ||
               text.includes('ミテネできる会員');
      });
      if (target) {
        target.click();
        return (target.textContent || target.value || '').trim().substring(0, 50);
      }
      return null;
    });

    if (clicked) {
      console.log(`  ✅ 「${clicked}」をクリック`);
      await this._wait(5000);
      await this._screenshot(page, 'mitene-member-list');
      return true;
    }

    // 見つからない場合、URLパターンで探す（J10ComeonVisitorList.php）
    console.log(`  ⚠️ テキストで見つからず。URLパターンで検索中...`);
    const allLinks = await page.evaluate(() => {
      return [...document.querySelectorAll('a')].map(a => ({
        text: (a.textContent || '').trim().substring(0, 60),
        href: a.href
      })).filter(l => l.text.length > 0);
    });

    // J10ComeonVisitorList.php が実際のURL
    const byUrl = allLinks.find(l =>
      l.href.match(/ComeonVisitor|kitene|mitene/i)
    );
    if (byUrl) {
      console.log(`  📎 URLパターンで発見: ${byUrl.text} → ${byUrl.href}`);
      await page.goto(byUrl.href, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._wait(3000);
      await this._screenshot(page, 'mitene-member-list');
      return true;
    }

    // デバッグ: 全リンクを出力
    console.log(`  ❌ ボタンもURLも見つかりません。ページ内のリンク:`);
    for (const l of allLinks.slice(0, 30)) {
      console.log(`    - ${l.text} → ${l.href}`);
    }
    await this._screenshot(page, 'mitene-search-not-found');
    return false;
  }

  // 残り回数を読み取る
  async _getRemainingCount(page) {
    const remaining = await page.evaluate(() => {
      const text = document.body.innerText;
      // 「残り回数: 10/10」「残り回数：8/10」などのパターン
      const match = text.match(/残り回数[：:]\s*(\d+)\s*[/／]\s*(\d+)/);
      if (match) {
        return { remaining: parseInt(match[1]), total: parseInt(match[2]) };
      }
      return null;
    });
    return remaining;
  }

  // タブに遷移してボタンが表示されるまで待つ
  async _navigateToTab(page, tabUrl, tabName) {
    console.log(`  🔄 タブ「${tabName}」に遷移 → ${tabUrl}`);
    try {
      await page.goto(tabUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (navErr) {
      console.log(`  ⚠️ ページ読み込みタイムアウト、続行を試みます...`);
      await this._wait(3000);
    }
    await this._wait(4000);
    try {
      await page.waitForSelector('a.kitene_send_btn__text_wrapper, a.mitene_send_btn__text_wrapper, a[onclick*="registComeon"]', { timeout: 15000 });
      console.log(`  ✅ ボタン検出OK（${tabName}）`);
      return true;
    } catch (e) {
      console.log(`  ⚠️ ボタン検出タイムアウト（${tabName}）。リロード再試行...`);
      try {
        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
      } catch (reloadErr) {
        console.log(`  ⚠️ リロードタイムアウト、続行を試みます...`);
      }
      await this._wait(5000);
      // リロード後もう一度チェック
      const btns = await page.$$('a.kitene_send_btn__text_wrapper, a.mitene_send_btn__text_wrapper, a[onclick*="registComeon"]');
      if (btns.length > 0) {
        console.log(`  ✅ リロード後ボタン検出OK（${tabName}）`);
        return true;
      }
      console.log(`  ❌ タブ「${tabName}」にボタンなし`);
      return false;
    }
  }

  // 1つのタブ内で送信ループを実行
  async _sendOnCurrentTab(page, memberListUrl, maxSends, sentCount, minWeeks, triedUids) {
    let errorCount = 0;
    let skipCount = 0;
    let tabExhausted = false; // このタブの全員がスキップ/処理済み

    for (let attempt = 0; attempt < maxSends * 3 && sentCount < maxSends; attempt++) {
      try {
        const buttons = await page.$$('a.kitene_send_btn__text_wrapper, a.mitene_send_btn__text_wrapper, a[onclick*="registComeon"]');

        if (buttons.length === 0) {
          console.log(`  📋 送信ボタンなし。`);
          tabExhausted = true;
          break;
        }

        let clickedButton = null;
        let clickedUid = null;
        let allChecked = true;
        for (const btn of buttons) {
          const btnInfo = await page.evaluate((el, minWeeksVal) => {
            const onclick = el.getAttribute('onclick') || '';
            const uidMatch = onclick.match(/registComeon\((\d+)\)/);
            if (!uidMatch) return { uid: null };

            const uid = uidMatch[1];

            let parentEl = el.parentElement;
            for (let i = 0; i < 8 && parentEl; i++) {
              const text = parentEl.textContent || '';
              if (!text.match(/送信済/)) { parentEl = parentEl.parentElement; continue; }

              const now = new Date();
              let sentDate = null;
              let sentLabel = '';

              const m1 = text.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*送信済/);
              if (m1) {
                sentDate = new Date(parseInt(m1[1]), parseInt(m1[2]) - 1, parseInt(m1[3]));
                sentLabel = `${m1[1]}/${m1[2]}/${m1[3]}`;
              }
              if (!sentDate) {
                const m2 = text.match(/(\d{1,2})[\/](\d{1,2})\s*送信済/);
                if (m2) {
                  const y = now.getFullYear();
                  sentDate = new Date(y, parseInt(m2[1]) - 1, parseInt(m2[2]));
                  if (sentDate > now) sentDate = new Date(y - 1, parseInt(m2[1]) - 1, parseInt(m2[2]));
                  sentLabel = `${m2[1]}/${m2[2]}`;
                }
              }
              if (!sentDate) {
                const m3 = text.match(/(\d{1,2})月(\d{1,2})日\s*送信済/);
                if (m3) {
                  const y = now.getFullYear();
                  sentDate = new Date(y, parseInt(m3[1]) - 1, parseInt(m3[2]));
                  if (sentDate > now) sentDate = new Date(y - 1, parseInt(m3[1]) - 1, parseInt(m3[2]));
                  sentLabel = `${m3[1]}月${m3[2]}日`;
                }
              }
              if (!sentDate && text.match(/(今日|本日)\s*送信済/)) {
                sentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                sentLabel = '今日';
              }
              if (!sentDate && text.match(/昨日\s*送信済/)) {
                sentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
                sentLabel = '昨日';
              }
              if (!sentDate) {
                const m6 = text.match(/(\d+)日前\s*送信済/);
                if (m6) {
                  sentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - parseInt(m6[1]));
                  sentLabel = `${m6[1]}日前`;
                }
              }
              if (!sentDate) {
                const m7 = text.match(/(\d+)時間前\s*送信済/);
                if (m7) {
                  sentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  sentLabel = `${m7[1]}時間前`;
                }
              }

              if (sentDate && minWeeksVal > 0) {
                const weeksDiff = (now - sentDate) / (7 * 24 * 60 * 60 * 1000);
                if (weeksDiff < minWeeksVal) {
                  return {
                    uid,
                    skip: true,
                    reason: `${sentLabel}送信済（${weeksDiff.toFixed(1)}週間前 < ${minWeeksVal}週間）`
                  };
                }
              }
              break;
            }

            return { uid, skip: false };
          }, btn, minWeeks);

          if (!btnInfo.uid) continue;

          if (triedUids.has(btnInfo.uid)) continue;
          allChecked = false;

          if (btnInfo.skip) {
            triedUids.add(btnInfo.uid);
            skipCount++;
            console.log(`  ⏭️ スキップ uid=${btnInfo.uid}: ${btnInfo.reason}`);
            continue;
          }

          clickedUid = btnInfo.uid;
          clickedButton = btn;
          break;
        }

        if (!clickedButton) {
          tabExhausted = true;
          console.log(`  📋 このタブで送信可能な人なし。`);
          break;
        }

        triedUids.add(clickedUid);
        console.log(`  🖱️ ボタンクリック uid=${clickedUid} (${sentCount + 1}/${maxSends})`);

        let lastDialogMessage = '';
        const dialogTracker = (dialog) => {
          lastDialogMessage = dialog.message();
        };
        page.on('dialog', dialogTracker);

        try {
          await clickedButton.click();
        } catch (clickErr) {
          console.log(`  ⚠️ クリック失敗（要素が消えた？）: ${clickErr.message}`);
          page.off('dialog', dialogTracker);
          try {
            await page.goto(memberListUrl, { waitUntil: 'networkidle2', timeout: 60000 });
          } catch (e2) { /* タイムアウトでも続行 */ }
          await this._wait(3000);
          continue;
        }
        await this._wait(5000);

        page.off('dialog', dialogTracker);

        if (lastDialogMessage.includes('エラー')) {
          errorCount++;
          console.log(`  ❌ 送信失敗: ${lastDialogMessage}`);
          try {
            await page.goto(memberListUrl, { waitUntil: 'networkidle2', timeout: 60000 });
          } catch (e2) { /* タイムアウトでも続行 */ }
          await this._wait(3000);
          continue;
        }

        const afterUrl = page.url();
        if (afterUrl !== memberListUrl) {
          console.log(`  📍 遷移検知: ${afterUrl}`);
          console.log(`  🔙 会員リストに戻る...`);
          try {
            await page.goto(memberListUrl, { waitUntil: 'networkidle2', timeout: 60000 });
          } catch (e2) {
            console.log(`  ⚠️ 戻りタイムアウト、続行...`);
          }
          await this._wait(3000);
        }

        sentCount++;
        console.log(`  ✅ ミテネ送信 ${sentCount}/${maxSends}`);

        const afterCount = await this._getRemainingCount(page);
        if (afterCount) {
          console.log(`  📊 残り回数: ${afterCount.remaining}/${afterCount.total}`);
          if (afterCount.remaining === 0) {
            console.log(`  🏁 残り回数0。`);
            break;
          }
        }
      } catch (e) {
        console.log(`  ⚠️ 送信エラー: ${e.message}`);
        errorCount++;
        try {
          await page.goto(memberListUrl, { waitUntil: 'networkidle2', timeout: 60000 });
          await this._wait(3000);
        } catch (navErr) {
          console.log(`  ⚠️ 復帰タイムアウト、続行を試みます...`);
          await this._wait(3000);
        }
      }
    }

    return { sentCount, errorCount, skipCount, tabExhausted };
  }

  // ステップ3: 全タブを順番に確認してキテネ送信
  async _sendToMembers(page, maxSends, minWeeks) {
    console.log(`  👋 会員リストからミテネ送信中（最大${maxSends}件）...`);

    // URLからgidを取得
    const currentUrl = page.url();
    const gidMatch = currentUrl.match(/gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : null;
    console.log(`  📍 現在のURL: ${currentUrl} (gid=${gid})`);

    if (!gid) {
      console.log(`  ⚠️ gid取得できず。現在のページのまま続行。`);
    }

    // タブ一覧をランダムな順序でシャッフル
    const tabOptions = [
      { name: 'みたよ', path: 'J10ComeonVisitorList.php' },
      { name: 'マイガール', path: 'J10ComeonMyGirlList.php' },
      { name: 'マッチ率', path: 'J10ComeonAiMatchingList.php' }
    ];
    // Fisher-Yates シャッフル
    for (let i = tabOptions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tabOptions[i], tabOptions[j]] = [tabOptions[j], tabOptions[i]];
    }
    console.log(`  🎲 タブ順序: ${tabOptions.map(t => t.name).join(' → ')}`);

    // 最初のタブに遷移
    if (gid) {
      const firstTabUrl = `https://spgirl.cityheaven.net/${tabOptions[0].path}?gid=${gid}`;
      await this._navigateToTab(page, firstTabUrl, tabOptions[0].name);
    }

    // 残り回数を確認
    let countInfo = null;
    for (let retry = 0; retry < 3; retry++) {
      countInfo = await this._getRemainingCount(page);
      if (countInfo) break;
      console.log(`  ⏳ 残り回数読み取り待機中... (${retry + 1}/3)`);
      await this._wait(3000);
    }
    if (countInfo) {
      console.log(`  📊 残り回数: ${countInfo.remaining}/${countInfo.total}`);
      if (countInfo.remaining === 0) {
        console.log(`  ⚠️ 残り回数が0です。送信できません。`);
        return { success: false, count: 0, error: '残り回数が0です' };
      }
      if (countInfo.remaining < maxSends) {
        maxSends = countInfo.remaining;
        console.log(`  📊 残り回数に合わせて最大${maxSends}件に調整`);
      }
    }

    let totalSent = 0;
    let totalErrors = 0;
    let totalSkipped = 0;
    const triedUids = new Set();

    // 各タブを順番に試す
    for (let tabIdx = 0; tabIdx < tabOptions.length && totalSent < maxSends; tabIdx++) {
      const tab = tabOptions[tabIdx];

      // 2番目以降のタブは遷移が必要
      if (tabIdx > 0 && gid) {
        const tabUrl = `https://spgirl.cityheaven.net/${tab.path}?gid=${gid}`;
        const hasButtons = await this._navigateToTab(page, tabUrl, tab.name);
        if (!hasButtons) {
          console.log(`  ⏭️ タブ「${tab.name}」スキップ（ボタンなし）`);
          continue;
        }
      }

      const memberListUrl = page.url();
      console.log(`  📂 タブ「${tab.name}」で送信開始...`);

      const result = await this._sendOnCurrentTab(
        page, memberListUrl, maxSends, totalSent, minWeeks, triedUids
      );

      totalSent = result.sentCount;
      totalErrors += result.errorCount;
      totalSkipped += result.skipCount;

      if (totalSent >= maxSends) {
        console.log(`  🏁 最大送信数到達（${totalSent}/${maxSends}）`);
        break;
      }

      if (result.tabExhausted && tabIdx < tabOptions.length - 1) {
        console.log(`  ➡️ 次のタブへ移動...`);
      }
    }

    if (totalSkipped > 0) {
      console.log(`  📊 スキップ合計: ${totalSkipped}人（${minWeeks}週間以内に送付済み）`);
    }
    console.log(`  📊 全タブ確認完了: 送信${totalSent}件 / スキップ${totalSkipped}人 / エラー${totalErrors}件`);

    await this._screenshot(page, 'mitene-after-send');
    const allSkipped = totalSent === 0 && totalSkipped > 0 && totalErrors === 0;
    return {
      success: totalSent > 0 || allSkipped,
      count: totalSent,
      errors: totalErrors,
      skipped: totalSkipped,
      message: allSkipped ? `全タブ確認済み・全員${minWeeks}週間以内に送信済みのためスキップ（${totalSkipped}人）` : undefined
    };
  }

  // メイン処理
  async send(account, settings = {}) {
    const maxSends = settings.miteneMaxSends || 10;
    const minWeeks = settings.miteneMinWeeks || 0;

    let page = null;
    try {
      const browser = await this._launchBrowser();
      page = await browser.newPage();

      // ダイアログ自動承認（「キテネしますか？」「ミテネしますか？」にOKを押す）
      page.on('dialog', async dialog => {
        console.log(`  💬 ダイアログ: ${dialog.message()}`);
        await dialog.accept();
      });

      console.log(`\n👋 ミテネ送信開始: ${account.name}`);
      console.log(`  設定: 最大${maxSends}件送信, ${minWeeks > 0 ? minWeeks + '週間以上経過した人のみ' : '制限なし'}`);

      // ステップ1: ログイン
      const loggedIn = await this._login(page, account);
      if (!loggedIn) return { success: false, error: 'ログイン失敗' };

      // ステップ2: 「キテネできる会員を探す」をクリック
      const found = await this._findMembers(page);
      if (!found) return { success: false, error: '「キテネ/ミテネできる会員を探す」が見つかりません' };

      // ステップ3: 会員に1人ずつ送信（ボタンクリック→確認ダイアログOK→ページに戻る→繰り返し）
      const result = await this._sendToMembers(page, maxSends, minWeeks);

      console.log(`  🏁 送信完了: ${result.count}件`);
      return result;
    } catch (e) {
      console.error(`  ❌ ミテネ送信エラー: ${e.message}`);
      return { success: false, error: e.message };
    } finally {
      if (page) await page.close().catch(() => {});
      await this._closeBrowser();
    }
  }
}

module.exports = new MiteneSender();
