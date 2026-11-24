@echo off
rem Starts SocialHub: Cloudflare Quick Tunnel, updates apps\api\.env with its URL, then the API.
rem The API and the tunnel each run in their own window. Stop them with stop-socialhub.cmd.
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed or not on PATH: https://nodejs.org & goto :end)
node "%~dp0scripts\socialhub-launcher.js" start %*
set "CODE=%ERRORLEVEL%"
:end
if not defined CODE set "CODE=1"
echo.
if not "%SOCIALHUB_NO_PAUSE%"=="1" pause
exit /b %CODE%
