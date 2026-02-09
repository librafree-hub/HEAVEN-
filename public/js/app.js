const App = {
  currentAccountId: null,
  _scheduleTimes: [], // 編集中アカウントの投稿時刻リスト

  // === 初期化 ===
  async init() {
    this.initNav();
    await this.loadDashboard();
  },

  // ナビゲーション
  initNav() {
    document.querySelectorAll('[data-page]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('[data-page]').forEach(l => l.classList.remove('active'));
        document.getElementById(`page-${page}`).classList.add('active');
        link.classList.add('active');

        if (page === 'dashboard') this.loadDashboard();
        if (page === 'accounts') this.loadAccounts();
        if (page === 'posts') this.loadPosts();
        if (page === 'settings') this.loadSettings();
      });
    });
  },

  // === API呼び出し ===
  async api(url, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`/api${url}`, opts);
    return res.json();
  },

  // === ダッシュボード ===
  async loadDashboard() {
    const stats = await this.api('/stats');
    document.getElementById('stat-today').textContent = stats.todayPosts;
    document.getElementById('stat-success').textContent = stats.successToday;
    document.getElementById('stat-failed').textContent = stats.failedToday;
    document.getElementById('stat-total').textContent = stats.totalPosts;

    // スケジューラー状態
    const badge = document.getElementById('scheduler-status');
    const btn = document.getElementById('btn-scheduler');
    if (stats.scheduler?.running) {
      const schedInfo = (stats.scheduler.schedules || [])
        .map(s => `${s.name}: ${s.times.join(', ')}`)
        .join(' | ');
      badge.textContent = '稼働中' + (schedInfo ? ` (${schedInfo})` : '');
      badge.className = 'status-badge running';
      btn.textContent = 'スケジューラー停止';
    } else {
      badge.textContent = '停止中';
      badge.className = 'status-badge';
      btn.textContent = 'スケジューラー開始';
    }

    // 最近の投稿
    const posts = await this.api('/posts?limit=10');
    document.getElementById('recent-posts').innerHTML = this.renderPostsTable(posts);
  },

  // === アカウント管理 ===
  async loadAccounts() {
    const accounts = await this.api('/accounts');
    const el = document.getElementById('accounts-list');

    if (accounts.length === 0) {
      el.innerHTML = '<div class="loading">アカウントがありません。「+ アカウント追加」から追加してください。</div>';
      return;
    }

    el.innerHTML = accounts.map(a => `
      <div class="account-card">
        <div class="account-card-header">
          <h4>${this.esc(a.name)}</h4>
          <span class="badge ${a.active ? 'badge-active' : 'badge-inactive'}">${a.active ? '有効' : '無効'}</span>
        </div>
        <div class="account-meta">
          ${this.esc(a.personality || '')}<br>
          画像: ${a.imageStats.total}枚（残り${a.imageStats.remaining}枚）<br>
          投稿: ${a.scheduleTimes && a.scheduleTimes.length > 0 ? a.scheduleTimes.join(', ') : `${a.postsPerDay || 3}回/日（時刻未設定）`}<br>
          ${{diary:'写メ日記',freepost:'フリーポスト',random:'ランダム'}[a.postType] || '写メ日記'} / ${{public:'全公開',mygirl:'マイガール',random:'ランダム'}[a.visibility] || '全公開'}
        </div>
        <div class="account-actions">
          <button class="btn btn-sm btn-primary" onclick="App.postSingle('${a.id}')">投稿</button>
          <button class="btn btn-sm btn-secondary" onclick="App.showImages('${a.id}', '${this.esc(a.name)}')">画像</button>
          <button class="btn btn-sm btn-secondary" onclick="App.editAccount('${a.id}')">編集</button>
          <button class="btn btn-sm btn-danger" onclick="App.deleteAccount('${a.id}', '${this.esc(a.name)}')">削除</button>
        </div>
      </div>
    `).join('');
  },

  showAddAccount() {
    document.getElementById('modal-account-title').textContent = 'アカウント追加';
    document.getElementById('acc-id').value = '';
    document.getElementById('form-account').reset();
    this._scheduleTimes = [];
    this.renderScheduleTimes();
    document.getElementById('modal-account').style.display = 'flex';
  },

  async editAccount(id) {
    const accounts = await this.api('/accounts');
    const a = accounts.find(acc => acc.id === id);
    if (!a) return;

    document.getElementById('modal-account-title').textContent = `${a.name} の編集`;
    document.getElementById('acc-id').value = a.id;
    document.getElementById('acc-name').value = a.name;
    document.getElementById('acc-personality').value = a.personality || '';
    document.getElementById('acc-tone').value = a.tone || '';
    document.getElementById('acc-interests').value = (a.interests || []).join(', ');
    document.getElementById('acc-writingStyle').value = a.writingStyle || '';
    document.getElementById('acc-postsPerDay').value = a.postsPerDay || 3;
    document.getElementById('acc-loginUrl').value = a.loginUrl || '';
    document.getElementById('acc-loginId').value = a.loginId || '';
    document.getElementById('acc-loginPassword').value = '';
    document.getElementById('acc-loginPassword').placeholder = a.loginPassword === '***' ? '設定済み（変更する場合のみ入力）' : 'パスワードを入力';
    document.getElementById('acc-diaryUrl').value = a.diaryUrl || '';
    document.getElementById('acc-postType').value = a.postType || 'diary';
    document.getElementById('acc-visibility').value = a.visibility || 'public';
    this._scheduleTimes = (a.scheduleTimes || []).slice();
    this.renderScheduleTimes();
    document.getElementById('modal-account').style.display = 'flex';
  },

  async saveAccount(e) {
    e.preventDefault();
    const id = document.getElementById('acc-id').value;
    const data = {
      name: document.getElementById('acc-name').value,
      personality: document.getElementById('acc-personality').value,
      tone: document.getElementById('acc-tone').value,
      interests: document.getElementById('acc-interests').value.split(',').map(s => s.trim()).filter(Boolean),
      writingStyle: document.getElementById('acc-writingStyle').value,
      postsPerDay: parseInt(document.getElementById('acc-postsPerDay').value) || 3,
      loginUrl: document.getElementById('acc-loginUrl').value,
      loginId: document.getElementById('acc-loginId').value,
      loginPassword: document.getElementById('acc-loginPassword').value || '***',
      diaryUrl: document.getElementById('acc-diaryUrl').value,
      postType: document.getElementById('acc-postType').value,
      visibility: document.getElementById('acc-visibility').value,
      scheduleTimes: this._scheduleTimes.slice(),
      active: true
    };

    if (id) {
      await this.api(`/accounts/${id}`, 'PUT', data);
    } else {
      await this.api('/accounts', 'POST', data);
    }

    this.closeModal('modal-account');
    this.loadAccounts();
  },

  async deleteAccount(id, name) {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    await this.api(`/accounts/${id}`, 'DELETE');
    this.loadAccounts();
  },

  // === 画像管理 ===
  async showImages(accountId, name) {
    this.currentAccountId = accountId;
    document.getElementById('modal-images-title').textContent = `${name} の画像`;
    document.getElementById('modal-images').style.display = 'flex';
    await this.refreshImages(accountId);
  },

  async refreshImages(accountId) {
    const data = await this.api(`/accounts/${accountId}/images`);
    const el = document.getElementById('image-list');

    if (data.images.length === 0) {
      el.innerHTML = '<div class="loading">画像がありません</div>';
      return;
    }

    el.innerHTML = data.images.map(img =>
      `<div class="image-thumb">
        <img src="/api/accounts/${accountId}/images/${encodeURIComponent(img)}" alt="${this.esc(img)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <div class="image-fallback" style="display:none">${this.esc(img)}</div>
        <button class="image-delete-btn" onclick="App.deleteImage('${accountId}','${this.esc(img)}')" title="削除">&times;</button>
      </div>`
    ).join('');
  },

  async deleteImage(accountId, filename) {
    if (!confirm(`この画像を削除しますか？\n${filename}`)) return;
    await fetch(`/api/accounts/${accountId}/images/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    await this.refreshImages(accountId);
    this.loadAccounts();
  },

  async uploadImages(e) {
    const files = e.target.files;
    if (!files.length || !this.currentAccountId) return;

    const formData = new FormData();
    for (const f of files) formData.append('images', f);

    await fetch(`/api/accounts/${this.currentAccountId}/images`, {
      method: 'POST',
      body: formData
    });

    e.target.value = '';
    await this.refreshImages(this.currentAccountId);
    this.loadAccounts();
  },

  // === 投稿 ===
  async postAll() {
    if (!confirm('全アカウントの投稿を開始しますか？')) return;
    await this.api('/post/all', 'POST');
    alert('投稿を開始しました。ダッシュボードで進捗を確認してください。');
  },

  async postSingle(accountId) {
    if (!confirm('このアカウントで投稿しますか？')) return;
    const result = await this.api(`/post/${accountId}`, 'POST');
    if (result.error) {
      alert(`エラー: ${result.error}`);
    } else {
      alert('投稿処理完了');
      this.loadDashboard();
    }
  },

  // === スケジューラー ===
  async toggleScheduler() {
    const stats = await this.api('/scheduler/status');
    if (stats.running) {
      await this.api('/scheduler/stop', 'POST');
    } else {
      await this.api('/scheduler/start', 'POST');
    }
    this.loadDashboard();
  },

  // === 投稿履歴 ===
  async loadPosts() {
    const posts = await this.api('/posts?limit=200');
    document.getElementById('posts-list').innerHTML = this.renderPostsTable(posts, true);
  },

  renderPostsTable(posts, showBody = false) {
    if (!posts || posts.length === 0) {
      return '<div class="loading">投稿がありません</div>';
    }

    const statusLabel = { success: '成功', failed: '失敗', test: 'テスト' };

    const typeLabel = { diary: '写メ日記', freepost: 'フリーポスト' };
    const visLabel = { public: '全公開', mygirl: 'マイガール' };

    let html = `<table class="posts-table">
      <thead><tr>
        <th>日時</th><th>アカウント</th><th>タイトル</th><th>文字数</th><th>種類</th><th>公開</th><th>状態</th>
      </tr></thead><tbody>`;

    for (const p of posts) {
      const time = new Date(p.timestamp).toLocaleString('ja-JP');
      html += `<tr>
        <td>${time}</td>
        <td>${this.esc(p.accountName || p.accountId)}</td>
        <td>${this.esc(p.title || '-')}</td>
        <td>${p.charCount || '-'}</td>
        <td>${typeLabel[p.postType] || '-'}</td>
        <td>${visLabel[p.visibility] || '-'}</td>
        <td class="status-${p.status}">${statusLabel[p.status] || p.status}</td>
      </tr>`;
      if (showBody && p.body) {
        html += `<tr><td colspan="7"><div class="post-preview">${this.esc(p.body)}</div></td></tr>`;
      }
    }

    html += '</tbody></table>';
    return html;
  },

  // === スケジュール時刻管理 ===
  addScheduleTime() {
    const h = document.getElementById('acc-addHour').value.padStart(2, '0');
    const m = document.getElementById('acc-addMin').value;
    const time = `${h}:${m}`;

    if (this._scheduleTimes.includes(time)) {
      alert(`${time} は既に追加されています`);
      return;
    }

    this._scheduleTimes.push(time);
    this._scheduleTimes.sort();
    this.renderScheduleTimes();
  },

  removeScheduleTime(time) {
    this._scheduleTimes = this._scheduleTimes.filter(t => t !== time);
    this.renderScheduleTimes();
  },

  renderScheduleTimes() {
    const el = document.getElementById('acc-scheduleTimes');
    if (this._scheduleTimes.length === 0) {
      el.innerHTML = '<div class="schedule-times-empty">投稿時刻が設定されていません</div>';
      return;
    }
    el.innerHTML = this._scheduleTimes.map(t =>
      `<span class="schedule-time-tag">${t}<button type="button" class="remove-time" onclick="App.removeScheduleTime('${t}')">&times;</button></span>`
    ).join('');
  },

  // === 設定 ===
  async loadSettings() {
    const settings = await this.api('/settings');
    document.getElementById('set-minChars').value = settings.minChars || 450;
    document.getElementById('set-maxChars').value = settings.maxChars || 1000;
    document.getElementById('set-postingEnabled').checked = settings.postingEnabled || false;
    document.getElementById('set-postType').value = settings.postType || 'diary';
    document.getElementById('set-visibility').value = settings.visibility || 'public';
  },

  async saveSettings(e) {
    e.preventDefault();
    const data = {
      minChars: parseInt(document.getElementById('set-minChars').value),
      maxChars: parseInt(document.getElementById('set-maxChars').value),
      postingEnabled: document.getElementById('set-postingEnabled').checked,
      postType: document.getElementById('set-postType').value,
      visibility: document.getElementById('set-visibility').value
    };
    await this.api('/settings', 'PUT', data);
    alert('設定を保存しました');
  },

  // === ユーティリティ ===
  closeModal(id) {
    document.getElementById(id).style.display = 'none';
  },

  esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

// 起動
document.addEventListener('DOMContentLoaded', () => App.init());
