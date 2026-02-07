const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

class AIGenerator {
  constructor() {
    this.model = null;
  }

  _getModel() {
    if (!this.model) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'your_gemini_api_key_here') {
        throw new Error('GEMINI_API_KEYが設定されていません。.envファイルを確認してください。');
      }
      const genAI = new GoogleGenerativeAI(apiKey);
      const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
      this.model = genAI.getGenerativeModel({ model: modelName });
    }
    return this.model;
  }

  // 日記テキストを生成
  async generateDiary(account, imagePath) {
    const model = this._getModel();

    const settings = this._loadSettings();
    const minChars = settings.minChars || 450;
    const maxChars = settings.maxChars || 1000;

    const prompt = `あなたは風俗店で働く「${account.name}」というキャストです。
以下のキャラクター設定に基づいて、シティヘブンの写メ日記を書いてください。

【キャラクター設定】
- 名前: ${account.name}
- 性格: ${account.personality}
- 口調: ${account.tone}
- 趣味・興味: ${(account.interests || []).join('、')}
- 文体: ${account.writingStyle}

【ルール】
- ${minChars}〜${maxChars}文字で書く
- 自然な日記風の文章にする
- 絵文字を適度に使う
- お客さんへの呼びかけを入れる
- 添付画像に触れる内容を含める
- 宣伝っぽくならないようにする
- 日常の出来事や気持ちを中心に書く

【出力形式】
1行目: タイトル（20文字以内）
2行目: 空行
3行目以降: 本文

タイトルと本文だけを出力してください。余計な説明は不要です。`;

    const parts = [{ text: prompt }];

    // 画像がある場合は添付
    if (imagePath && fs.existsSync(imagePath)) {
      const imageData = fs.readFileSync(imagePath);
      const ext = path.extname(imagePath).toLowerCase();
      const mimeMap = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif',
        '.webp': 'image/webp'
      };
      const mimeType = mimeMap[ext] || 'image/jpeg';
      parts.push({
        inlineData: {
          mimeType,
          data: imageData.toString('base64')
        }
      });
    }

    const result = await model.generateContent(parts);
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
