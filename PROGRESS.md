# HEAVEN- 進捗共有ファイル

このファイルはClaude / ChatGPT間で進捗を共有するためのものです。
修正や調査を行った際にここを更新してください。

---

## 現在の状況 (2026-02-08)

### 完了済み
- Web ダッシュボード構築 (Express + Puppeteer + Gemini AI)
- アカウント管理 / 画像管理 / 投稿履歴 / スケジューラー
- Gemini AI で日記テキスト生成（画像はGeminiに送らずCityHeaven投稿時のみアップロード）
- CityHeaven ログイン自動化 (#userid, #passwd, #loginBtn)
- 日記フォーム入力: タイトル(#diaryTitle) / 本文(#diary) / 投稿タイプ(#shame/#freepos) / 公開範囲(#limited_diary_kind) / 画像(#picSelect)
- 画像削除機能（ダッシュボードから×ボタンで削除）
- パスワード保持バグ修正
- Gemini安全性フィルタ対策（画像をGeminiに送らない方式に変更）

### 対応中 / 未解決
- **投稿ボタンの問題**: 「デコメーラーで投稿する」が押されて実際に投稿されない
  - 修正: #diary が属する form を特定し、そのform内のsubmitボタンを押す方式に変更済み（テスト待ち）
- 投稿後の確認: diaryListUrl に遷移してタイトルの反映をチェックする機能追加済み（テスト待ち）

### アーキテクチャ
- サーバー: Node.js + Express (localhost:3000)
- ブラウザ自動化: Puppeteer (headless: false)
- AI生成: Google Gemini (gemini-2.5-flash)
- スケジューラ: node-cron (デフォルト: 3時間ごと 8-23時)
- DB: JSONファイル (data/db/)
- 画像: data/images/account_X/

### CityHeaven フォームセレクタ
| 要素 | セレクタ |
|------|---------|
| ログインID | #userid |
| パスワード | #passwd |
| ログインボタン | #loginBtn |
| タイトル | #diaryTitle |
| 本文 | #diary |
| 公開範囲 | #limited_diary_kind |
| 写メ日記 | #shame |
| フリーポスト | #freepos |
| 画像アップ | #picSelect |

### accounts.json の構成
```json
{
  "id": "account_1",
  "name": "りな",
  "loginUrl": "https://spgirl.cityheaven.net/J1Login.php",
  "loginId": "63986113",
  "loginPassword": "****",
  "diaryUrl": "https://spgirl.cityheaven.net/J4KeitaiDiaryPost.php?gid=63986113",
  "diaryListUrl": "https://spgirl.cityheaven.net/J4KeitaiDiaryList.php?gid=63986113",
  "postType": "diary",
  "visibility": "random"
}
```

### 主要ファイル
- `server.js` - Expressサーバー
- `src/services/cityhaven-poster.js` - CityHeaven投稿自動化
- `src/services/ai-generator.js` - Gemini AI日記生成
- `src/services/scheduler.js` - 自動投稿スケジューラ
- `src/services/database.js` - JSONデータベース
- `src/services/image-manager.js` - 画像管理
- `src/routes/api.js` - REST APIルート
- `public/` - ダッシュボードUI
- `config/accounts.json` - アカウント設定
- `config/settings.json` - グローバル設定
