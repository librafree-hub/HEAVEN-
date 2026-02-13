const App = {
  currentAccountId: null,
  diaryRefreshTimer: null,
  miteneRefreshTimer: null,

  // === 初期化 ===
  async init() {
    this.initNav();
    await this.loadDiary();
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

        // ページ切り替え時に自動更新を停止
        this.stopDiaryRefresh();
        this.stopMiteneRefresh();

        if (page === 'diary') this.loadDiary();
        if (page === 'mitene') this.loadMitene();
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

  // =============================================
  // === 写メ日記ページ ===
  // =============================================
  async loadDiary() {
    await this.updateDiaryPanel();

    // アカウント一覧
    const accounts = await this.api('/accounts');
    const el = document.getElementById('diary-accounts-list');

    if (accounts.length === 0) {
      el.innerHTML = '<div class="loading">アカウントがありません。「+ 追加」から女の子を追加してください。</div>';
    } else {
      el.innerHTML = accounts.map(a => `
        <div class="mitene-account-row">
          <span class="mitene-account-name">${this.esc(a.name)}</span>
          <span class="mitene-account-info">
            ${a.active ? '<span class="text-success">有効</span>' : '<span class="text-danger">無効</span>'}
            / 画像 ${a.imageStats.total}枚（残り${a.imageStats.remaining}枚）
            / ${a.postsPerDay}回/日
          </span>
          <span class="mitene-account-status" id="diary-acc-status-${a.id}"></span>
          <button class="btn btn-sm btn-primary" id="diary-btn-${a.id}" onclick="App.postSingle('${a.id}')">投稿</button>
          <button class="btn btn-sm btn-secondary" onclick="App.showImages('${a.id}', '${this.esc(a.name)}')">画像</button>
          <button class="btn btn-sm btn-secondary" onclick="App.editAccount('${a.id}')">編集</button>
          <button class="btn btn-sm btn-danger" onclick="App.deleteAccount('${a.id}', '${this.esc(a.name)}')">削除</button>
        </div>
      `).join('');
    }

    // 写メ日記の投稿履歴
    const posts = await this.api('/posts?limit=200');
    const diaryPosts = posts.filter(p => p.postType !== 'mitene');
    const historyEl = document.getElementById('diary-history');
    if (diaryPosts.length === 0) {
      historyEl.innerHTML = '<div class="loading">投稿履歴がありません</div>';
    } else {
      historyEl.innerHTML = this.renderPostsTable(diaryPosts);
    }

    // 5秒ごとに自動更新
    this.startDiaryRefresh();
  },

  startDiaryRefresh() {
    this.stopDiaryRefresh();
    this.diaryRefreshTimer = setInterval(async () => {
      if (!document.getElementById('page-diary').classList.contains('active')) {
        this.stopDiaryRefresh();
        return;
      }
      await this.updateDiaryPanel();
    }, 5000);
  },

  stopDiaryRefresh() {
    if (this.diaryRefreshTimer) {
      clearInterval(this.diaryRefreshTimer);
      this.diaryRefreshTimer = null;
    }
  },

  async updateDiaryPanel() {
    const stats = await this.api('/stats');
    // 今日の投稿からミテネを除外して写メ日記のみカウント
    const todayAll = await this.api('/posts/today');
    const diaryToday = todayAll.filter(p => p.postType !== 'mitene');
    const diarySuccess = diaryToday.filter(p => p.status === 'success').length;
    const diaryFailed = diaryToday.filter(p => p.status === 'failed').length;

    // ステータスパネル
    const icon = document.getElementById('diary-live-icon');
    const liveStatus = document.getElementById('diary-live-status');
    const lastRun = document.getElementById('diary-last-run');
    const todayCount = document.getElementById('diary-today-count');
    const todayResult = document.getElementById('diary-today-result');

    if (icon && liveStatus) {
      if (stats.scheduler?.running) {
        icon.className = 'status-panel-icon active';
        liveStatus.textContent = '自動実行中';
      } else {
        icon.className = 'status-panel-icon';
        liveStatus.textContent = '停止中';
      }
    }

    if (lastRun) {
      if (stats.lastPost && stats.lastPost.timestamp) {
        const d = new Date(stats.lastPost.timestamp);
        lastRun.textContent = d.toLocaleString('ja-JP');
      } else {
        lastRun.textContent = 'まだ投稿していません';
      }
    }

    if (todayCount) {
      todayCount.textContent = `${diaryToday.length} 件`;
    }

    if (todayResult) {
      todayResult.textContent = `${diarySuccess} / ${diaryFailed}`;
    }

    // スケジューラーボタン更新
    const badge = document.getElementById('diary-scheduler-status');
    const btn = document.getElementById('btn-diary-scheduler');
    if (badge && btn) {
      if (stats.scheduler?.running) {
        badge.textContent = '稼働中';
        badge.className = 'status-badge running';
        btn.textContent = 'スケジューラー停止';
      } else {
        badge.textContent = '停止中';
        badge.className = 'status-badge';
        btn.textContent = 'スケジューラー開始';
      }
    }
  },

  // === 写メ日記 スケジューラー ===
  async toggleScheduler() {
    const stats = await this.api('/scheduler/status');
    if (stats.running) {
      await this.api('/scheduler/stop', 'POST');
    } else {
      await this.api('/scheduler/start', 'POST');
    }
    await this.updateDiaryPanel();
  },

  // === 写メ日記 投稿 ===
  async postAll() {
    if (!confirm('全アカウントの投稿を開始しますか？')) return;
    await this.api('/post/all', 'POST');
    setTimeout(() => this.updateDiaryPanel(), 1000);
  },

  async postSingle(accountId) {
    if (!confirm('このアカウントで投稿しますか？')) return;

    const btn = document.getElementById(`diary-btn-${accountId}`);
    const statusEl = document.getElementById(`diary-acc-status-${accountId}`);
    if (btn) { btn.disabled = true; btn.textContent = '投稿中...'; }
    if (statusEl) { statusEl.textContent = '処理中...'; statusEl.className = 'mitene-account-status sending'; }

    const result = await this.api(`/post/${accountId}`, 'POST');

    if (btn) { btn.disabled = false; btn.textContent = '投稿'; }

    if (result.error) {
      if (statusEl) { statusEl.textContent = '失敗'; statusEl.className = 'mitene-account-status failed'; }
      alert(`エラー: ${result.error}`);
    } else {
      if (statusEl) { statusEl.textContent = '成功!'; statusEl.className = 'mitene-account-status success'; }
      alert('投稿処理完了');
    }

    // 履歴を更新
    if (document.getElementById('page-diary').classList.contains('active')) {
      const posts = await this.api('/posts?limit=200');
      const diaryPosts = posts.filter(p => p.postType !== 'mitene');
      const historyEl = document.getElementById('diary-history');
      if (diaryPosts.length > 0) {
        historyEl.innerHTML = this.renderPostsTable(diaryPosts);
      }
      await this.updateDiaryPanel();
    }
  },

  // =============================================
  // === ミテネページ（完全に別管理）===
  // =============================================
  async loadMitene() {
    // ミテネ専用アカウント一覧
    const accounts = await this.api('/mitene-accounts');
    const el = document.getElementById('mitene-accounts-list');

    if (accounts.length === 0) {
      el.innerHTML = '<div class="loading">ミテネアカウントがありません。「+ 追加」から女の子を追加してください。</div>';
    } else {
      el.innerHTML = `<div class="mitene-accounts-grid">${accounts.map(a => `
        <div class="mitene-account-row">
          <input type="checkbox" class="mitene-select-cb" value="${a.id}" style="margin-right:8px; cursor:pointer;">
          <span class="mitene-account-name">${this.esc(a.name)}</span>
          <span class="mitene-account-info">
            ${a.loginId ? 'ID設定済' : '<span class="text-danger">ID未設定</span>'}
            / 予約: 毎日 ${this.esc(a.schedule || '未設定')}
          </span>
          <span class="mitene-account-status" id="mitene-acc-status-${a.id}"></span>
          <button class="btn btn-sm btn-mitene" id="mitene-btn-${a.id}" onclick="App.miteneSingle('${a.id}')">今すぐ送信</button>
          <button class="btn btn-sm btn-secondary" onclick="App.editMiteneAccount('${a.id}')">編集</button>
          <button class="btn btn-sm btn-danger" onclick="App.deleteMiteneAccount('${a.id}', '${this.esc(a.name)}')">削除</button>
        </div>
      `).join('')}</div>`;
    }

    // ステータスパネル更新
    await this.updateMitenePanel();

    // ミテネ送信履歴
    const posts = await this.api('/posts?limit=200');
    const mitenePosts = posts.filter(p => p.postType === 'mitene');
    const historyEl = document.getElementById('mitene-history');
    if (mitenePosts.length === 0) {
      historyEl.innerHTML = '<div class="loading">ミテネ送信履歴がありません</div>';
    } else {
      this.renderMiteneHistory(historyEl, mitenePosts);
    }

    // 5秒ごとに自動更新
    this.startMiteneRefresh();
  },

  startMiteneRefresh() {
    this.stopMiteneRefresh();
    this.miteneRefreshTimer = setInterval(async () => {
      if (!document.getElementById('page-mitene').classList.contains('active')) {
        this.stopMiteneRefresh();
        return;
      }
      await this.updateMitenePanel();
    }, 5000);
  },

  stopMiteneRefresh() {
    if (this.miteneRefreshTimer) {
      clearInterval(this.miteneRefreshTimer);
      this.miteneRefreshTimer = null;
    }
  },

  async updateMitenePanel() {
    const status = await this.api('/mitene/status');
    const posts = await this.api('/posts/today');
    const miteneToday = posts.filter(p => p.postType === 'mitene');
    const successToday = miteneToday.filter(p => p.status === 'success').length;
    const failedToday = miteneToday.filter(p => p.status === 'failed').length;

    // ステータスパネル
    const icon = document.getElementById('mitene-live-icon');
    const liveStatus = document.getElementById('mitene-live-status');
    const todayCount = document.getElementById('mitene-today-count');

    // いずれかのアカウントが実行中か確認
    const anyRunning = status.accounts && Object.values(status.accounts).some(a => a.isRunning);

    if (icon && liveStatus) {
      if (anyRunning) {
        icon.className = 'status-panel-icon mitene-color active pulse';
        liveStatus.textContent = '送信中...';
      } else if (status.running) {
        icon.className = 'status-panel-icon mitene-color active';
        liveStatus.textContent = '自動実行中';
      } else {
        icon.className = 'status-panel-icon mitene-color';
        liveStatus.textContent = '停止中';
      }
    }

    if (todayCount) {
      todayCount.textContent = `${successToday} 回成功 / ${failedToday} 回失敗`;
    }

    // スケジューラーボタン更新
    const badge = document.getElementById('mitene-scheduler-status');
    const btn = document.getElementById('btn-mitene-scheduler');
    if (badge && btn) {
      if (status.running) {
        badge.textContent = '稼働中';
        badge.className = 'status-badge running';
        btn.textContent = 'スケジューラー停止';
      } else {
        badge.textContent = '停止中';
        badge.className = 'status-badge';
        btn.textContent = 'スケジューラー開始';
      }
    }
  },

  renderMiteneHistory(el, posts) {
    const statusLabel = { success: '成功', failed: '失敗' };
    let html = `<table class="posts-table">
      <thead><tr>
        <th>日時</th><th>アカウント</th><th>結果</th><th>詳細</th>
      </tr></thead><tbody>`;

    for (const p of posts) {
      const time = new Date(p.timestamp).toLocaleString('ja-JP');
      html += `<tr>
        <td>${time}</td>
        <td>${this.esc(p.accountName || p.accountId)}</td>
        <td class="status-${p.status}">${statusLabel[p.status] || p.status}</td>
        <td>${this.esc(p.message || '-')}</td>
      </tr>`;
    }

    html += '</tbody></table>';
    el.innerHTML = html;
  },

  async miteneAll() {
    if (!confirm('全アカウントでミテネを送信しますか？')) return;
    await this.api('/mitene/all', 'POST');
    setTimeout(() => this.updateMitenePanel(), 1000);
  },

  async miteneSingle(accountId) {
    if (!confirm('このアカウントで今すぐミテネを送信しますか？')) return;

    const btn = document.getElementById(`mitene-btn-${accountId}`);
    const statusEl = document.getElementById(`mitene-acc-status-${accountId}`);
    if (btn) { btn.disabled = true; btn.textContent = '送信中...'; }
    if (statusEl) { statusEl.textContent = '処理中...'; statusEl.className = 'mitene-account-status sending'; }

    const result = await this.api(`/mitene/send/${accountId}`, 'POST');

    if (btn) { btn.disabled = false; btn.textContent = '今すぐ送信'; }

    if (result.error) {
      if (statusEl) { statusEl.textContent = '失敗'; statusEl.className = 'mitene-account-status failed'; }
      alert(`エラー: ${result.error}`);
    } else if (result.success) {
      if (statusEl) { statusEl.textContent = '成功!'; statusEl.className = 'mitene-account-status success'; }
      alert(`ミテネ送信完了`);
    } else {
      if (statusEl) { statusEl.textContent = '失敗'; statusEl.className = 'mitene-account-status failed'; }
      alert(`ミテネ送信失敗: ${result.error || '不明なエラー'}`);
    }

    // 履歴を更新
    if (document.getElementById('page-mitene').classList.contains('active')) {
      const posts = await this.api('/posts?limit=200');
      const mitenePosts = posts.filter(p => p.postType === 'mitene');
      const historyEl = document.getElementById('mitene-history');
      if (mitenePosts.length > 0) {
        this.renderMiteneHistory(historyEl, mitenePosts);
      }
      await this.updateMitenePanel();
    }
  },

  async toggleMiteneScheduler() {
    const status = await this.api('/mitene/status');
    if (status.running) {
      await this.api('/mitene/scheduler/stop', 'POST');
    } else {
      await this.api('/mitene/scheduler/start', 'POST');
    }
    await this.updateMitenePanel();
  },

  // === ミテネ 全選択・ランダム送信 ===

  toggleMiteneSelectAll() {
    const checked = document.getElementById('mitene-select-all').checked;
    document.querySelectorAll('.mitene-select-cb').forEach(cb => cb.checked = checked);
  },

  async miteneRandomSend() {
    const selected = [...document.querySelectorAll('.mitene-select-cb:checked')].map(cb => cb.value);
    if (selected.length === 0) { alert('送信する子を選択してください'); return; }
    if (!confirm(`${selected.length}人をランダムな間隔で送信します。よろしいですか？`)) return;

    const result = await this.api('/mitene/random-send', 'POST', { accountIds: selected });
    if (result.error) {
      alert('エラー: ' + result.error);
    } else {
      alert(`${selected.length}人のランダム送信を開始しました。\n順番と間隔はランダムです。`);
    }
    await this.updateMitenePanel();
  },

  // === ミテネアカウント管理 ===

  showAddMiteneAccount() {
    document.getElementById('modal-mitene-title').textContent = 'ミテネアカウント追加';
    document.getElementById('mitene-acc-id').value = '';
    document.getElementById('form-mitene-account').reset();
    document.getElementById('mitene-acc-schedule').value = '10:00';
    document.getElementById('modal-mitene-account').style.display = 'flex';
  },

  async editMiteneAccount(id) {
    const accounts = await this.api('/mitene-accounts');
    const a = accounts.find(acc => acc.id === id);
    if (!a) return;

    document.getElementById('modal-mitene-title').textContent = `${a.name} の編集`;
    document.getElementById('mitene-acc-id').value = a.id;
    document.getElementById('mitene-acc-name').value = a.name;
    document.getElementById('mitene-acc-loginUrl').value = a.loginUrl || '';
    document.getElementById('mitene-acc-loginId').value = a.loginId || '';
    document.getElementById('mitene-acc-loginPassword').value = '';
    document.getElementById('mitene-acc-loginPassword').placeholder = a.loginPassword === '***' ? '設定済み' : 'パスワード';
    document.getElementById('mitene-acc-schedule').value = a.schedule || '10:00';
    document.getElementById('modal-mitene-account').style.display = 'flex';
  },

  async saveMiteneAccount(e) {
    e.preventDefault();
    try {
      const id = document.getElementById('mitene-acc-id').value;
      const data = {
        name: document.getElementById('mitene-acc-name').value,
        loginUrl: document.getElementById('mitene-acc-loginUrl').value,
        loginId: document.getElementById('mitene-acc-loginId').value,
        loginPassword: document.getElementById('mitene-acc-loginPassword').value || '***',
        schedule: document.getElementById('mitene-acc-schedule').value,
        active: true
      };

      if (id) {
        await this.api(`/mitene-accounts/${id}`, 'PUT', data);
      } else {
        await this.api('/mitene-accounts', 'POST', data);
      }

      this.closeModal('modal-mitene-account');
      this.loadMitene();
    } catch (err) {
      alert('保存エラー: ' + err.message);
    }
  },

  async deleteMiteneAccount(id, name) {
    if (!confirm(`「${name}」をミテネアカウントから削除しますか？`)) return;
    await this.api(`/mitene-accounts/${id}`, 'DELETE');
    this.loadMitene();
  },

  // =============================================
  // === 写メ日記 アカウント管理 ===
  // =============================================
  showAddAccount() {
    document.getElementById('modal-account-title').textContent = 'アカウント追加';
    document.getElementById('acc-id').value = '';
    document.getElementById('form-account').reset();
    document.getElementById('acc-sample-count').textContent = '';
    document.getElementById('modal-account').style.display = 'flex';
  },

  async fetchDiarySamples() {
    const url = document.getElementById('acc-diaryPageUrl').value.trim();
    if (!url) { alert('公開日記ページURLを入力してください'); return; }

    const accountId = document.getElementById('acc-id').value || '_temp';
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = '取得中...';

    try {
      const result = await this.api(`/accounts/${accountId}/scrape-diary`, 'POST', { diaryPageUrl: url });
      if (result.error) {
        alert(`取得失敗: ${result.error}`);
      } else {
        // サンプルをテキストエリアに表示
        const text = result.entries.map(e => `【${e.title}】\n${e.body}`).join('\n\n');
        document.getElementById('acc-sampleDiaries').value = text;
        document.getElementById('acc-sample-count').textContent = `${result.entries.length}件の日記を取得しました`;
      }
    } catch (err) {
      alert('取得エラー: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '取得';
    }
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
    document.getElementById('acc-diaryPageUrl').value = a.diaryPageUrl || '';
    document.getElementById('acc-sampleDiaries').value = a.sampleDiaries || '';
    document.getElementById('acc-postType').value = a.postType || 'diary';
    document.getElementById('acc-visibility').value = a.visibility || 'public';
    // サンプル数表示
    const sampleText = a.sampleDiaries || '';
    const sampleCount = sampleText ? sampleText.split(/\n\s*\n/).filter(s => s.trim().length > 20).length : 0;
    document.getElementById('acc-sample-count').textContent = sampleCount > 0 ? `${sampleCount}件のサンプル日記あり` : '';
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
      diaryPageUrl: document.getElementById('acc-diaryPageUrl').value,
      sampleDiaries: document.getElementById('acc-sampleDiaries').value,
      postType: document.getElementById('acc-postType').value,
      visibility: document.getElementById('acc-visibility').value,
      active: true
    };

    if (id) {
      await this.api(`/accounts/${id}`, 'PUT', data);
    } else {
      await this.api('/accounts', 'POST', data);
    }

    this.closeModal('modal-account');
    this.loadDiary();
  },

  async deleteAccount(id, name) {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    await this.api(`/accounts/${id}`, 'DELETE');
    this.loadDiary();
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
  },

  // =============================================
  // === 設定 ===
  // =============================================
  async loadSettings() {
    const settings = await this.api('/settings');
    document.getElementById('set-geminiApiKey').value = '';
    document.getElementById('set-geminiApiKey').placeholder = settings.geminiApiKey ? '設定済み（変更する場合のみ入力）' : 'Gemini APIキーを入力';
    document.getElementById('set-geminiModel').value = settings.geminiModel || 'gemini-2.0-flash';
    document.getElementById('set-minChars').value = settings.minChars || 450;
    document.getElementById('set-maxChars').value = settings.maxChars || 1000;
    document.getElementById('set-schedule').value = settings.schedule || '0 */3 8-23 * * *';
    document.getElementById('set-postingEnabled').checked = settings.postingEnabled || false;
    document.getElementById('set-postType').value = settings.postType || 'diary';
    document.getElementById('set-visibility').value = settings.visibility || 'public';
    document.getElementById('set-miteneMaxSends').value = settings.miteneMaxSends || 10;
    document.getElementById('set-miteneMinWeeks').value = settings.miteneMinWeeks || 0;
  },

  async saveSettings(e) {
    e.preventDefault();
    const data = {
      minChars: parseInt(document.getElementById('set-minChars').value),
      maxChars: parseInt(document.getElementById('set-maxChars').value),
      schedule: document.getElementById('set-schedule').value,
      postingEnabled: document.getElementById('set-postingEnabled').checked,
      postType: document.getElementById('set-postType').value,
      visibility: document.getElementById('set-visibility').value,
      miteneMaxSends: parseInt(document.getElementById('set-miteneMaxSends').value) || 10,
      miteneMinWeeks: parseInt(document.getElementById('set-miteneMinWeeks').value) || 0
    };
    // APIキーが入力されてる場合のみ保存
    const apiKey = document.getElementById('set-geminiApiKey').value.trim();
    if (apiKey) data.geminiApiKey = apiKey;
    data.geminiModel = document.getElementById('set-geminiModel').value;
    await this.api('/settings', 'PUT', data);
    alert('設定を保存しました');
  },

  // =============================================
  // === 共通ユーティリティ ===
  // =============================================
  renderPostsTable(posts, showBody = false) {
    if (!posts || posts.length === 0) {
      return '<div class="loading">投稿がありません</div>';
    }

    const statusLabel = { success: '成功', failed: '失敗', test: 'テスト' };
    const typeLabel = { diary: '写メ日記', freepost: 'フリーポスト', mitene: 'ミテネ' };
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
