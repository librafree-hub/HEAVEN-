const fs = require('fs');
const path = require('path');
const database = require('./database');

const IMAGES_DIR = path.join(__dirname, '../../data/images');

class ImageManager {
  constructor() {
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(IMAGES_DIR)) {
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
    }
  }

  // アカウントの画像フォルダパス
  getAccountDir(accountId) {
    return path.join(IMAGES_DIR, accountId);
  }

  // アカウントの全画像を取得
  getAccountImages(accountId) {
    const dir = this.getAccountDir(accountId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      return [];
    }
    const exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    return fs.readdirSync(dir).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return exts.includes(ext);
    });
  }

  // まだ使っていない画像から1枚選ぶ
  selectImage(accountId) {
    const allImages = this.getAccountImages(accountId);
    if (allImages.length === 0) return null;

    const usedImages = database.getUsedImages(accountId);
    let available = allImages.filter(img => !usedImages.includes(img));

    // 全部使い切ったらリセット
    if (available.length === 0) {
      database.resetUsedImages(accountId);
      available = allImages;
    }

    // ランダムに選択
    const selected = available[Math.floor(Math.random() * available.length)];
    database.markImageUsed(accountId, selected);

    return {
      name: selected,
      path: path.join(this.getAccountDir(accountId), selected)
    };
  }

  // アカウントごとの画像統計
  getImageStats(accountId) {
    const allImages = this.getAccountImages(accountId);
    const usedImages = database.getUsedImages(accountId);
    return {
      total: allImages.length,
      used: usedImages.length,
      remaining: allImages.length - usedImages.filter(u => allImages.includes(u)).length
    };
  }
}

module.exports = new ImageManager();
