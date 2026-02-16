@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ================================================
echo   HEAVEN- 起動中...
echo ================================================
echo.

REM Node.js チェック
where node >nul 2>&1
if errorlevel 1 (
    echo   ❌ Node.js が見つかりません！
    echo   先に「初回セットアップ.bat」を実行してください。
    echo.
    pause
    exit /b
)

REM .env チェック
if not exist ".env" (
    echo   ❌ .env ファイルがありません！
    echo   先に「初回セットアップ.bat」を実行してください。
    echo.
    pause
    exit /b
)

echo [1/3] 最新版に更新中...
git pull origin main 2>nul
if errorlevel 1 (
    echo   ※更新をスキップしました
)
echo.

echo [2/3] パッケージ確認中...
call npm install --silent
if errorlevel 1 (
    echo   ※npm installに問題がありました
    pause
    exit /b
)
echo.

echo [3/3] サーバー起動中...
echo.
REM 既にサーバーが動いている場合は停止
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    echo   既存のサーバーを停止しています...
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo ================================================
echo   ※このウィンドウは閉じないでください
echo ================================================
echo.

call npm start
echo.
echo ================================================
echo   サーバーが停止しました。
echo   エラーが発生した場合は上のメッセージを確認してください。
echo ================================================
pause
