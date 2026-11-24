@echo off
rem Stops only the API and tunnel that the SocialHub launcher started. Other programs are left alone.
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed or not on PATH: https://nodejs.org & goto :end)
node "%~dp0scripts\socialhub-launcher.js" stop %*
set "CODE=%ERRORLEVEL%"
:end
if not defined CODE set "CODE=1"
echo.
if not "%SOCIALHUB_NO_PAUSE%"=="1" pause
exit /b %CODE%
