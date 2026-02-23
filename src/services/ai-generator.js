const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// Gemini: 現在有効なモデル一覧（1.5系は全て廃止済み）
const GEMINI_FALLBACK = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

// OpenAI: フォールバックモデル
const OPENAI_FALLBACK = [
  'gpt-4o-mini',
  'gpt-4o',
];

class AIGenerator {
  constructor() {
    this._geminiModels = {};
    this._openaiClient = null;
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

  // --- Gemini ---
  _getGeminiApiKey() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      throw new Error('Gemini APIキーが設定されていません。設定ページで入力してください。');
    }
    return apiKey;
  }

  _getGeminiModel(modelName) {
    if (this._geminiModels[modelName]) return this._geminiModels[modelName];
    const genAI = new GoogleGenerativeAI(this._getGeminiApiKey());
    this._geminiModels[modelName] = genAI.getGenerativeModel({
      model: modelName,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ]
    });
    return this._geminiModels[modelName];
  }

  async _generateWithGemini(prompt, settings) {
    const preferred = settings.geminiModel || 'gemini-2.0-flash';
    const modelOrder = [preferred, ...GEMINI_FALLBACK.filter(m => m !== preferred)];
    const errors = [];

    for (const modelName of modelOrder) {
      try {
        const model = this._getGeminiModel(modelName);
        console.log(`  🤖 Gemini: ${modelName}`);
        const result = await model.generateContent(prompt);
        const text = (result.response.text() || '').trim();
        if (text) return { text, model: modelName };
        console.log(`  ⚠️ ${modelName} → 応答が空。次のモデルへ...`);
        errors.push(`${modelName}: 応答が空`);
      } catch (e) {
        const msg = e.message || '';
        if (msg.includes('401') || msg.includes('403') || msg.includes('API_KEY')) throw e;
        const reason = msg.includes('429') ? '上限到達' : msg.includes('404') ? 'モデル廃止' : 'エラー';
        console.log(`  ⚠️ ${modelName} → ${reason}。次のモデルへ...`);
        errors.push(`${modelName}: ${reason}`);
      }
    }
    throw new Error(`Gemini全モデル失敗:\n${errors.join('\n')}`);
  }

  // --- OpenAI ---
  _getOpenAIClient() {
    if (this._openaiClient) return this._openaiClient;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI APIキーが設定されていません。設定ページで入力してください。');
    const OpenAI = require('openai');
    this._openaiClient = new OpenAI({ apiKey });
    return this._openaiClient;
  }

  async _generateWithOpenAI(prompt, settings) {
    const client = this._getOpenAIClient();
    const preferred = settings.openaiModel || 'gpt-4o-mini';
    const modelOrder = [preferred, ...OPENAI_FALLBACK.filter(m => m !== preferred)];
    const errors = [];

    for (const modelName of modelOrder) {
      try {
        console.log(`  🤖 OpenAI: ${modelName}`);
        const response = await client.chat.completions.create({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2000,
          temperature: 0.8,
        });
        const text = (response.choices[0]?.message?.content || '').trim();
        if (text) return { text, model: modelName };
        console.log(`  ⚠️ ${modelName} → 応答が空。次のモデルへ...`);
        errors.push(`${modelName}: 応答が空`);
      } catch (e) {
        const msg = e.message || '';
        if (msg.includes('401') || msg.includes('Incorrect API key')) throw e;
        const reason = msg.includes('429') ? '上限到達' : 'エラー';
        console.log(`  ⚠️ ${modelName} → ${reason}。次のモデルへ...`);
        errors.push(`${modelName}: ${reason}`);
      }
    }
    throw new Error(`OpenAI全モデル失敗:\n${errors.join('\n')}`);
  }

  // --- サンプル日記 ---
  _getSampleDiaries(account) {
    if (account.sampleDiaries && account.sampleDiaries.trim()) {
      const samples = account.sampleDiaries.split(/\n\s*\n/).filter(s => s.trim().length > 20);
      if (samples.length > 0) return samples;
    }
    try {
      const diaryScraper = require('./diary-scraper');
      const entries = diaryScraper.loadSamples(account.id);
      if (entries.length > 0) return entries.map(e => `【${e.title}】\n${e.body}`);
    } catch (e) { /* 無視 */ }
    return [];
  }

  // --- カテゴリ別の指示 ---
  _getCategoryInstruction(category) {
    const categories = {
      'syukkin': '【日記カテゴリ: 出勤日記】\n今日の出勤報告です。今日の意気込み、お客さんに会えるのが楽しみという気持ち、今日のコーデやメイクについて触れてください。',
      'taikin': '【日記カテゴリ: 退勤日記】\n今日の退勤報告です。今日一日の感想、お客さんへの感謝、疲れたけど楽しかった等の内容にしてください。',
      'orei': '【日記カテゴリ: お礼日記】\n来てくれたお客さんへのお礼日記です。具体的な名前は出さず、「今日来てくれた方」「先日のお兄さん」等のぼかした表現で、楽しかった・嬉しかったという気持ちを書いてください。',
      'zatsudan': '【日記カテゴリ: 雑談日記】\n日常の雑談日記です。趣味、食べ物、お出かけ、最近ハマっていること等、仕事以外のプライベートな内容を中心に書いてください。',
      'event': '【日記カテゴリ: イベント日記】\nイベントや季節の話題の日記です。季節のイベント、お店のイベント、記念日など、特別な出来事について書いてください。',
    };
    return categories[category] || '';
  }

  // --- メイン生成 ---
  async generateDiary(account, imagePath, category = null) {
    const settings = this._loadSettings();
    const minChars = settings.minChars || 450;
    const maxChars = settings.maxChars || 1000;
    const provider = settings.aiProvider || 'gemini';

    const samples = this._getSampleDiaries(account);
    let sampleSection = '';
    if (samples.length > 0) {
      const shuffled = [...samples].sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, 5);
      sampleSection = `\n【過去の日記サンプル（この文体・口調・雰囲気を真似てください）】\n${picked.map((s, i) => `--- サンプル${i + 1} ---\n${s}`).join('\n\n')}\n\n★重要: 上記サンプルの文体、口調、絵文字の使い方、改行の入れ方、言い回しを忠実に真似てください。サンプルの内容をそのままコピーせず、同じ雰囲気で新しい内容を書いてください。\n`;
    }

    const categoryInstruction = this._getCategoryInstruction(category);
    if (category) {
      console.log(`  📂 カテゴリ: ${category}`);
    }

    const prompt = `あなたは風俗店で働く「${account.name}」というキャストです。
以下のキャラクター設定に基づいて、シティヘブンの写メ日記を書いてください。

【キャラクター設定】
- 名前: ${account.name}
- 性格: ${account.personality || '設定なし'}
- 口調: ${account.tone || '設定なし'}
- 趣味・興味: ${(account.interests || []).join('、') || '設定なし'}
- 文体: ${account.writingStyle || '設定なし'}
${categoryInstruction}
${sampleSection}
【ルール】
- ${minChars}〜${maxChars}文字で書く
- 自然な日記風の文章にする
- 絵文字を適度に使う（ただしUnicode絵文字は使わず、♪♡★☆等の記号絵文字を使う）
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

    console.log(`  🧠 AIプロバイダー: ${provider === 'openai' ? 'OpenAI' : 'Gemini'}`);

    const MAX_RETRIES = 2;
    const allErrors = [];

    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      try {
        const generateFn = provider === 'openai'
          ? this._generateWithOpenAI.bind(this)
          : this._generateWithGemini.bind(this);

        const { text, model } = await generateFn(prompt, settings);

        const lines = text.split('\n');
        const title = lines[0].replace(/^#\s*/, '').trim();
        const body = lines.slice(1).join('\n').trim();

        if (!body || body.length < 50) {
          console.log(`  ⚠️ ${model} → 本文が短すぎます（${body.length}文字）。リトライ${retry + 1}/${MAX_RETRIES}...`);
          allErrors.push(`${model}: 本文${body.length}文字（短すぎ）`);
          continue;
        }

        return { title: title.substring(0, 20), body, charCount: body.length };
      } catch (e) {
        allErrors.push(e.message);
        if (retry < MAX_RETRIES) {
          console.log(`  ⚠️ リトライ${retry + 1}/${MAX_RETRIES}...`);
        }
      }
    }

    throw new Error(`AI生成失敗:\n${allErrors.join('\n')}\n\n時間を置くか、APIキーの設定を確認してください。`);
  }
}

module.exports = new AIGenerator();
