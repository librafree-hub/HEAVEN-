@echo off
echo ================================================
echo HEAVEN- 自動起動セットアップ
echo ================================================
echo.
echo PC起動時にHEAVEN-を自動で起動するよう設定します。
echo.

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT=%STARTUP_DIR%\HEAVEN起動.lnk
set SCRIPT_PATH=%~dp0HEAVEN起動.bat

echo ショートカット作成先: %STARTUP_DIR%
echo.

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%SHORTCUT%'); $sc.TargetPath = '%SCRIPT_PATH%'; $sc.WorkingDirectory = '%~dp0'; $sc.WindowStyle = 7; $sc.Save()"

if exist "%SHORTCUT%" (
    echo ✅ 自動起動を設定しました！
    echo    次回のPC起動時から自動的にHEAVEN-が起動します。
) else (
    echo ❌ 設定に失敗しました。手動でスタートアップフォルダにショートカットを追加してください。
)
echo.
echo 解除する場合: %STARTUP_DIR% から「HEAVEN起動」を削除
echo.
pause
