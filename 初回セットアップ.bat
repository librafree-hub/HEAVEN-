@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ================================================
echo   HEAVEN- 初回セットアップ
echo ================================================
echo.
echo  新しいPCでHEAVENを使えるようにします。
echo.

REM ========================================
REM 1. Node.js チェック
REM ========================================
echo [1/5] Node.js を確認中...
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   ❌ Node.js がインストールされていません！
    echo.
    echo   以下のURLからインストールしてください：
    echo   https://nodejs.org/
    echo.
    echo   「LTS」版をダウンロード → インストール → このファイルを再実行
    echo.
    pause
    exit /b
)
for /f "tokens=*" %%i in ('node -v') do echo   ✅ Node.js %%i を検出

REM ========================================
REM 2. Git チェック
REM ========================================
echo.
echo [2/5] Git を確認中...
where git >nul 2>&1
if errorlevel 1 (
    echo.
    echo   ❌ Git がインストールされていません！
    echo.
    echo   以下のURLからインストールしてください：
    echo   https://git-scm.com/
    echo.
    echo   インストール → このファイルを再実行
    echo.
    pause
    exit /b
)
for /f "tokens=*" %%i in ('git --version') do echo   ✅ %%i を検出

REM ========================================
REM 3. GitHub認証チェック
REM ========================================
echo.
echo [3/5] GitHub接続を確認中...
git fetch origin >nul 2>&1
if errorlevel 1 (
    echo   ⚠️  GitHubに接続できません。ログインが必要です。
    echo.
    echo   ブラウザでGitHubのログイン画面が出たらログインしてください。
    echo   （初回のみ。次回以降は自動で接続されます）
    echo.
    git pull origin main
    if errorlevel 1 (
        echo.
        echo   ❌ GitHub接続に失敗しました。
        echo   GitHubアカウントでログインしてください。
        echo.
        pause
        exit /b
    )
) else (
    echo   ✅ GitHub接続OK
)

REM ========================================
REM 4. パッケージインストール
REM ========================================
echo.
echo [4/5] パッケージをインストール中...
call npm install --silent
if errorlevel 1 (
    echo   ❌ パッケージのインストールに失敗しました
    pause
    exit /b
)
echo   ✅ パッケージインストール完了

REM ========================================
REM 5. .env ファイル作成
REM ========================================
echo.
echo [5/5] 設定ファイルを確認中...
if exist ".env" (
    echo   ✅ .env ファイルは既に存在します
) else (
    copy .env.example .env >nul
    echo   ✅ .env ファイルを作成しました
    echo.
    echo   ================================================
    echo   ⚠️  APIキーの設定が必要です！
    echo   ================================================
    echo.
    echo   .env ファイルをメモ帳で開きます。
    echo   GEMINI_API_KEY= の後にAPIキーを貼り付けて保存してください。
    echo.
    echo   ※APIキーはメインPCの .env ファイルからコピーできます
    echo.
    pause
    notepad .env
)

echo.
echo ================================================
echo   ✅ セットアップ完了！
echo ================================================
echo.
echo   起動方法: 「HEAVEN起動.bat」をダブルクリック
echo.
echo   ※PC起動時に自動起動したい場合は
echo     「auto-startup-setup.bat」を実行してください
echo.
pause
