const App = {
  refreshTimer: null,

  // === 初期化 ===
  async init() {
    this.initNav();
    await this.loadMitene();
  },

  // ナビゲーション
  initNav() {
    document.querySelectorAll('[data-page]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('[data-page]').forEach(l => l.classList.remove('active'));
        // 写メ日記/ミテネのページリンクのactiveも外す
        document.querySelectorAll('.nav-menu a').forEach(l => l.classList.remove('active'));
        document.getElementById(`page-${page}`).classList.add('active');
        link.classList.add('active');

        this.stopRefresh();

        if (page === 'mitene') this.loadMitene();
        if (page === 'settings') this.loadSettings();
      });
    });
  },

  // === API呼び出し ===
  async api(url, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`/api/mitene${url}`, opts);
    return res.json();
  },

  // =============================================
  // === ミテネページ ===
  // =============================================
  async loadMitene() {
    const accounts = await this.api('/accounts');
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

    await this.updateMitenePanel();

    const posts = await this.api('/posts?limit=200');
    const historyEl = document.getElementById('mitene-history');
    if (posts.length === 0) {
      historyEl.innerHTML = '<div class="loading">ミテネ送信履歴がありません</div>';
    } else {
      this.renderMiteneHistory(historyEl, posts);
    }

    this.startRefresh();
  },

  startRefresh() {
    this.stopRefresh();
    this.refreshTimer = setInterval(async () => {
      if (!document.getElementById('page-mitene').classList.contains('active')) {
        this.stopRefresh();
        return;
      }
      await this.updateMitenePanel();
    }, 5000);
  },

  stopRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  async updateMitenePanel() {
    const status = await this.api('/status');
    const posts = await this.api('/posts/today');
    const successToday = posts.filter(p => p.status === 'success').length;
    const failedToday = posts.filter(p => p.status === 'failed').length;

    const icon = document.getElementById('mitene-live-icon');
    const liveStatus = document.getElementById('mitene-live-status');
    const todayCount = document.getElementById('mitene-today-count');

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
    await this.api('/send/all', 'POST');
    setTimeout(() => this.updateMitenePanel(), 1000);
  },

  async miteneSingle(accountId) {
    if (!confirm('このアカウントで今すぐミテネを送信しますか？')) return;

    const btn = document.getElementById(`mitene-btn-${accountId}`);
    const statusEl = document.getElementById(`mitene-acc-status-${accountId}`);
    if (btn) { btn.disabled = true; btn.textContent = '送信中...'; }
    if (statusEl) { statusEl.textContent = '処理中...'; statusEl.className = 'mitene-account-status sending'; }

    const result = await this.api(`/send/${accountId}`, 'POST');

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

    const posts = await this.api('/posts?limit=200');
    const historyEl = document.getElementById('mitene-history');
    if (posts.length > 0) {
      this.renderMiteneHistory(historyEl, posts);
    }
    await this.updateMitenePanel();
  },

  async toggleMiteneScheduler() {
    const status = await this.api('/status');
    if (status.running) {
      await this.api('/scheduler/stop', 'POST');
    } else {
      await this.api('/scheduler/start', 'POST');
    }
    await this.updateMitenePanel();
  },

  // === ミテネ 全選択・ランダム送信 ===

  toggleMiteneSelectAll() {
    const checked = document.getElementById('mitene-select-all').checked;
    document.querySelectorAll('.mitene-select-cb').forEach(cb => cb.checked = checked);
  },

  miteneRandomSelect() {
    const all = [...document.querySelectorAll('.mitene-select-cb')];
    const count = parseInt(document.getElementById('mitene-random-count').value) || 1;
    all.forEach(cb => cb.checked = false);
    document.getElementById('mitene-select-all').checked = false;
    const shuffled = [...all].sort(() => Math.random() - 0.5);
    const pick = Math.min(count, shuffled.length);
    for (let i = 0; i < pick; i++) shuffled[i].checked = true;
  },

  async miteneRandomSend() {
    const selected = [...document.querySelectorAll('.mitene-select-cb:checked')].map(cb => cb.value);
    if (selected.length === 0) { alert('送信する子を選択してください'); return; }

    const from = document.getElementById('mitene-random-from').value;
    const to = document.getElementById('mitene-random-to').value;
    if (!from || !to) { alert('時間帯を設定してください'); return; }

    if (!confirm(`${selected.length}人を ${from}〜${to} の間でランダムに送信します。よろしいですか？`)) return;

    const result = await this.api('/random-send', 'POST', { accountIds: selected, from, to });
    if (result.error) {
      alert('エラー: ' + result.error);
    } else {
      const times = result.scheduledTimes || [];
      const list = times.map(t => `  ${t.name}: ${t.time}`).join('\n');
      document.getElementById('mitene-random-status').textContent = `${selected.length}人のランダム送信を予約しました`;
      alert(`ランダム送信を予約しました:\n\n${list}\n\nサーバーを起動したままにしてください。`);
    }
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
    const accounts = await this.api('/accounts');
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

      const result = id
        ? await this.api(`/accounts/${id}`, 'PUT', data)
        : await this.api('/accounts', 'POST', data);

      if (result.error) { alert(result.error); return; }

      this.closeModal('modal-mitene-account');
      this.loadMitene();
    } catch (err) {
      alert('保存エラー: ' + err.message);
    }
  },

  async deleteMiteneAccount(id, name) {
    if (!confirm(`「${name}」をミテネアカウントから削除しますか？`)) return;
    await this.api(`/accounts/${id}`, 'DELETE');
    this.loadMitene();
  },

  // =============================================
  // === ミテネ設定 ===
  // =============================================
  async loadSettings() {
    const settings = await this.api('/settings');
    document.getElementById('set-miteneMaxSends').value = settings.miteneMaxSends || 10;
    document.getElementById('set-miteneMinWeeks').value = settings.miteneMinWeeks || 0;
  },

  async saveSettings(e) {
    e.preventDefault();
    const data = {
      miteneMaxSends: parseInt(document.getElementById('set-miteneMaxSends').value) || 10,
      miteneMinWeeks: parseInt(document.getElementById('set-miteneMinWeeks').value) || 0
    };
    await this.api('/settings', 'PUT', data);
    alert('設定を保存しました');
  },

  // =============================================
  // === 共通ユーティリティ ===
  // =============================================
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
