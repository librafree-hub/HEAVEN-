# HEAVEN - 自動日記投稿システム

## どのPCでも使える仕組み

- ダッシュボードで設定を変更 → 自動でGitHubに保存
- 別のPCで起動 → 自動でGitHubから最新を取得
- **どのPCで変更しても、他のPCに自動反映される**

## 新しいPCで使う手順

### 事前に用意するもの
- `GEMINI_API_KEY`（メインPCの `.env` ファイルに書いてある）

### 手順

**1. Node.js と Git をインストール**（まだの場合）
- [Node.js](https://nodejs.org/) （LTS版）
- [Git](https://git-scm.com/)

**2. コマンドプロンプトで以下を実行**
```
git clone https://github.com/librafree-hub/HEAVEN-.git
```

**3. `初回セットアップ.bat` をダブルクリック**
- 環境チェック → パッケージインストール → APIキー設定まで自動

**4. `HEAVEN起動.bat` をダブルクリック**

### 毎回の起動
`HEAVEN起動.bat` をダブルクリックするだけ（自動で最新に更新される）
