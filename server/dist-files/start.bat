@echo off
rem Starts the Blockcraft server. Needs Node.js 20 or newer (https://nodejs.org).
cd /d "%~dp0"
where node >nul 2>nul || (
  echo The Blockcraft server needs Node.js 20 or newer. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node server.mjs
pause
