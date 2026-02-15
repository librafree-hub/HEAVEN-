@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ================================================
echo   HEAVEN- 起動中...
echo ================================================
echo.

echo [1/3] 最新版に更新中...
git pull origin claude/clone-librafree-repo-RU0fa 2>&1
echo.

echo [2/3] パッケージ確認中...
call npm install --silent 2>&1
echo.

echo [3/3] サーバー起動中...
echo ================================================
echo   http://localhost:3000 をブラウザで開きます
echo   ※このウィンドウは閉じないでください
echo ================================================
echo.

timeout /t 3 /nobreak >nul
start http://localhost:3000

call npm start

echo.
echo サーバーが停止しました。
pause
