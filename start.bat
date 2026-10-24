@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   WorldForge 世界观锻造炉
echo   服务地址 http://127.0.0.1:7317
echo   浏览器会自动打开；关掉这个窗口就等于停掉服务（数据已实时写盘）
echo.
start "" powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:7317'"
node server.mjs --port 7317
pause
