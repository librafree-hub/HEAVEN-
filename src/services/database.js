const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '../../data/db');
const POSTS_FILE = path.join(DB_DIR, 'posts.json');
const USED_IMAGES_FILE = path.join(DB_DIR, 'used-images.json');

class Database {
  constructor() {
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
  }

  _readJson(filePath, defaultValue = []) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch (e) {
      console.error(`DB読み込みエラー: ${filePath}`, e.message);
    }
    return defaultValue;
  }

  _writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // 投稿履歴
  getPosts(limit = 100) {
    const posts = this._readJson(POSTS_FILE);
    return posts.slice(-limit).reverse();
  }

  getPostsByAccount(accountId) {
    const posts = this._readJson(POSTS_FILE);
    return posts.filter(p => p.accountId === accountId).reverse();
  }

  getTodayPosts() {
    const today = new Date().toISOString().split('T')[0];
    const posts = this._readJson(POSTS_FILE);
    return posts.filter(p => p.date === today);
  }

  addPost(post) {
    const posts = this._readJson(POSTS_FILE);
    const entry = {
      id: Date.now().toString(),
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
      ...post
    };
    posts.push(entry);
    this._writeJson(POSTS_FILE, posts);
    return entry;
  }

  // 使用済み画像の追跡
  getUsedImages(accountId) {
    const data = this._readJson(USED_IMAGES_FILE, {});
    return data[accountId] || [];
  }

  markImageUsed(accountId, imageName) {
    const data = this._readJson(USED_IMAGES_FILE, {});
    if (!data[accountId]) data[accountId] = [];
    if (!data[accountId].includes(imageName)) {
      data[accountId].push(imageName);
    }
    this._writeJson(USED_IMAGES_FILE, data);
  }

  resetUsedImages(accountId) {
    const data = this._readJson(USED_IMAGES_FILE, {});
    data[accountId] = [];
    this._writeJson(USED_IMAGES_FILE, data);
  }

  // 統計
  getStats() {
    const posts = this._readJson(POSTS_FILE);
    const today = new Date().toISOString().split('T')[0];
    const todayPosts = posts.filter(p => p.date === today);

    const byAccount = {};
    for (const p of posts) {
      if (!byAccount[p.accountId]) byAccount[p.accountId] = { total: 0, today: 0 };
      byAccount[p.accountId].total++;
      if (p.date === today) byAccount[p.accountId].today++;
    }

    return {
      totalPosts: posts.length,
      todayPosts: todayPosts.length,
      successToday: todayPosts.filter(p => p.status === 'success').length,
      failedToday: todayPosts.filter(p => p.status === 'failed').length,
      byAccount,
      lastPost: posts.length > 0 ? posts[posts.length - 1] : null
    };
  }
}

module.exports = new Database();
