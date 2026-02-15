@echo off
cd /d "%~dp0"
echo HEAVEN- を起動しています...
echo ブラウザで http://localhost:3000 を開いてください
echo.
echo ※このウィンドウは閉じないでください（閉じるとシステムが停止します）
echo ================================================
start http://localhost:3000
npm start
pause
