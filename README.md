# HEAVEN - 自動日記投稿システム

## 新しいPCで使う手順

### メインPCで事前に必要なこと
1. このリポジトリがGitHubにプッシュされていること
2. `.env` ファイル内の `GEMINI_API_KEY` を控えておく（新PCで入力が必要）

### 新しいPCでの手順（3ステップ）

**ステップ1: 必要なソフトをインストール**
- [Node.js](https://nodejs.org/) （LTS版）
- [Git](https://git-scm.com/)

**ステップ2: リポジトリをダウンロード**
```
git clone https://github.com/librafree-hub/HEAVEN-.git
```

**ステップ3: セットアップ＆起動**
1. フォルダ内の `初回セットアップ.bat` をダブルクリック
2. `.env` ファイルが開くので、`GEMINI_API_KEY=` の後にAPIキーを貼り付けて保存
3. `HEAVEN起動.bat` をダブルクリックで起動

### 毎回の起動
- `HEAVEN起動.bat` をダブルクリックするだけ
- PC起動時に自動起動したい場合は `auto-startup-setup.bat` を実行
