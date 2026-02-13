const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SAMPLES_DIR = path.join(__dirname, '../../data/diary-samples');

class DiaryScraper {
  // 公開日記ページからテキストを取得
  async scrape(diaryPageUrl, maxEntries = 10) {
    if (!diaryPageUrl) throw new Error('日記ページURLが未設定です');

    console.log(`  📖 日記ページ取得中: ${diaryPageUrl}`);
    const html = await this._fetch(diaryPageUrl);

    const entries = this._parseEntries(html);
    console.log(`  📖 ${entries.length}件の公開日記を取得`);

    // maxEntries件まで
    return entries.slice(0, maxEntries);
  }

  // HTMLから日記エントリを抽出
  _parseEntries(html) {
    const entries = [];

    // 日記ブロックを探す複数パターン
    // パターン1: <h3>タイトル</h3> + テキスト
    // パターン2: class="diary" 系のブロック内テキスト

    // まず「マイガール限定」を含むブロックを除外しつつ、日記テキストを取得
    // シティヘブンの日記ページは各エントリが区切られている

    // テキスト部分を抽出（HTMLタグ除去）
    // 日記のタイトル+本文ペアを探す

    // h3タグからタイトルを取得
    const titleRegex = /<h3[^>]*>\s*<a[^>]*>([^<]+)<\/a>\s*<\/h3>/gi;
    const titles = [];
    let m;
    while ((m = titleRegex.exec(html)) !== null) {
      titles.push({ title: m[1].trim(), index: m.index + m[0].length });
    }

    if (titles.length === 0) {
      // h3以外のタイトルパターンも試す
      const altTitleRegex = /<[^>]*class="[^"]*diary[^"]*title[^"]*"[^>]*>([^<]+)<\//gi;
      while ((m = altTitleRegex.exec(html)) !== null) {
        titles.push({ title: m[1].trim(), index: m.index + m[0].length });
      }
    }

    for (let i = 0; i < titles.length; i++) {
      const startIdx = titles[i].index;
      const endIdx = i + 1 < titles.length ? titles[i + 1].index - 200 : startIdx + 5000;
      const block = html.substring(startIdx, Math.min(endIdx, startIdx + 5000));

      // マイガール限定はスキップ
      if (block.includes('マイガール限定の日記です') || block.includes('閲覧するには')) {
        continue;
      }

      // ブロック内のテキストを抽出（HTMLタグ除去）
      const text = this._extractText(block);

      // 短すぎるのは除外（日付やボタンテキストのみのケース）
      if (text.length < 30) continue;

      entries.push({
        title: titles[i].title,
        body: text
      });
    }

    return entries;
  }

  // HTMLからテキストだけを抽出
  _extractText(html) {
    let text = html;
    // scriptとstyleを除去
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // brを改行に
    text = text.replace(/<br\s*\/?>/gi, '\n');
    // 全HTMLタグ除去
    text = text.replace(/<[^>]+>/g, '');
    // HTMLエンティティをデコード
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
    // 余分な空白・改行を整理
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n/g, '\n');
    text = text.trim();

    // 日時情報やナビゲーション文字列を除去
    text = text.replace(/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}/g, '');
    text = text.replace(/(いいね|コメント|シェア)\s*\d*/g, '');
    text = text.trim();

    return text;
  }

  // HTTPSでページを取得
  _fetch(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'ja,en;q=0.9'
        }
      }, (res) => {
        // リダイレクト対応
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this._fetch(res.headers.location).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('タイムアウト')); });
    });
  }

  // アカウントID別にサンプルを保存
  saveSamples(accountId, entries) {
    if (!fs.existsSync(SAMPLES_DIR)) fs.mkdirSync(SAMPLES_DIR, { recursive: true });
    const filePath = path.join(SAMPLES_DIR, `${accountId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
    console.log(`  💾 ${entries.length}件のサンプル保存: ${filePath}`);
    return entries;
  }

  // 保存済みサンプルを読み込み
  loadSamples(accountId) {
    const filePath = path.join(SAMPLES_DIR, `${accountId}.json`);
    if (!fs.existsSync(filePath)) return [];
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      return [];
    }
  }

  // スクレイプして保存
  async scrapeAndSave(accountId, diaryPageUrl) {
    const entries = await this.scrape(diaryPageUrl);
    this.saveSamples(accountId, entries);
    return entries;
  }
}

module.exports = new DiaryScraper();
