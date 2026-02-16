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
echo [1/4] Node.js を確認中...
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
echo [2/4] Git を確認中...
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
REM 3. パッケージインストール
REM ========================================
echo.
echo [3/4] パッケージをインストール中...
call npm install --silent
if errorlevel 1 (
    echo   ❌ パッケージのインストールに失敗しました
    pause
    exit /b
)
echo   ✅ パッケージインストール完了

REM ========================================
REM 4. .env ファイル作成
REM ========================================
echo.
echo [4/4] 設定ファイルを確認中...
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
