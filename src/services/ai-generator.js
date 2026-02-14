const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const FALLBACK_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-8b',
  'gemini-2.5-flash-preview-05-20',
];

class AIGenerator {
  constructor() {
    this._models = {};
  }

  _getApiKey() {
    const settings = this._loadSettings();
    const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      throw new Error('GEMINI_API_KEYが設定されていません。設定ページでAPIキーを入力してください。');
    }
    return apiKey;
  }

  _getModel(modelName) {
    if (this._models[modelName]) return this._models[modelName];

    const genAI = new GoogleGenerativeAI(this._getApiKey());
    this._models[modelName] = genAI.getGenerativeModel({
      model: modelName,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ]
    });
    return this._models[modelName];
  }

  // サンプル日記を取得（保存済みファイル or アカウント内テキスト）
  _getSampleDiaries(account) {
    // 1. アカウントに直接テキストがある場合
    if (account.sampleDiaries && account.sampleDiaries.trim()) {
      const samples = account.sampleDiaries.split(/\n\s*\n/).filter(s => s.trim().length > 20);
      if (samples.length > 0) return samples;
    }

    // 2. スクレイプ済みファイルがある場合
    try {
      const diaryScraper = require('./diary-scraper');
      const entries = diaryScraper.loadSamples(account.id);
      if (entries.length > 0) {
        return entries.map(e => `【${e.title}】\n${e.body}`);
      }
    } catch (e) { /* 無視 */ }

    return [];
  }

  // 日記テキストを生成
  async generateDiary(account, imagePath) {
    const settings = this._loadSettings();
    const minChars = settings.minChars || 450;
    const maxChars = settings.maxChars || 1000;

    // サンプル日記があればプロンプトに含める
    const samples = this._getSampleDiaries(account);
    let sampleSection = '';
    if (samples.length > 0) {
      // 最大5件をランダムに選択
      const shuffled = [...samples].sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, 5);
      sampleSection = `\n【過去の日記サンプル（この文体・口調・雰囲気を真似てください）】\n${picked.map((s, i) => `--- サンプル${i + 1} ---\n${s}`).join('\n\n')}\n\n★重要: 上記サンプルの文体、口調、絵文字の使い方、改行の入れ方、言い回しを忠実に真似てください。サンプルの内容をそのままコピーせず、同じ雰囲気で新しい内容を書いてください。\n`;
    }

    const prompt = `あなたは風俗店で働く「${account.name}」というキャストです。
以下のキャラクター設定に基づいて、シティヘブンの写メ日記を書いてください。

【キャラクター設定】
- 名前: ${account.name}
- 性格: ${account.personality || '設定なし'}
- 口調: ${account.tone || '設定なし'}
- 趣味・興味: ${(account.interests || []).join('、') || '設定なし'}
- 文体: ${account.writingStyle || '設定なし'}
${sampleSection}
【ルール】
- ${minChars}〜${maxChars}文字で書く
- 自然な日記風の文章にする
- 絵文字を適度に使う
- お客さんへの呼びかけを入れる
- 写真も一緒に投稿するので、写真を撮ったことや自撮りに軽く触れる内容を自然に含める
- 宣伝っぽくならないようにする
- 日常の出来事や気持ちを中心に書く
${samples.length > 0 ? '- サンプル日記の文体を最優先で真似ること\n' : ''}
【出力形式】
1行目: タイトル（20文字以内）
2行目: 空行
3行目以降: 本文

タイトルと本文だけを出力してください。余計な説明は不要です。`;

    // 設定モデルを先頭にしたフォールバック順を作成
    const preferred = settings.geminiModel || 'gemini-2.0-flash';
    const modelOrder = [preferred, ...FALLBACK_MODELS.filter(m => m !== preferred)];

    let result;
    let usedModel = '';
    for (const modelName of modelOrder) {
      try {
        const model = this._getModel(modelName);
        console.log(`  🤖 モデル: ${modelName}`);
        result = await model.generateContent(prompt);
        usedModel = modelName;
        break;
      } catch (e) {
        if (e.message && e.message.includes('429')) {
          console.log(`  ⚠️ ${modelName} → 上限到達。次のモデルを試します...`);
          continue;
        }
        throw e;
      }
    }
    if (!result) {
      throw new Error('全モデルの無料枠を使い切りました。時間を置くか、APIキーの課金設定を確認してください。');
    }
    if (usedModel !== preferred) {
      console.log(`  ✅ ${usedModel} で生成成功（フォールバック）`);
    }
    const text = result.response.text().trim();

    // タイトルと本文を分離
    const lines = text.split('\n');
    const title = lines[0].replace(/^#\s*/, '').trim();
    const body = lines.slice(1).join('\n').trim();

    return {
      title: title.substring(0, 20),
      body,
      charCount: body.length
    };
  }

  _loadSettings() {
    try {
      const settingsPath = path.join(__dirname, '../../config/settings.json');
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
    } catch (e) { /* デフォルト使用 */ }
    return {};
  }
}

module.exports = new AIGenerator();
