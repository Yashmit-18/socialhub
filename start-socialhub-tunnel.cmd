@echo off
rem Starts (or reuses) the Cloudflare Quick Tunnel in its own window and writes its URL to apps\api\.env.
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed or not on PATH: https://nodejs.org & goto :end)
node "%~dp0scripts\socialhub-launcher.js" start-tunnel %*
set "CODE=%ERRORLEVEL%"
:end
if not defined CODE set "CODE=1"
echo.
if not "%SOCIALHUB_NO_PAUSE%"=="1" pause
exit /b %CODE%
