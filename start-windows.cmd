@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 24 LTS from https://nodejs.org and reopen this file.
 pause
 exit /b 1
)
if not exist node_modules\whatsapp-web.js\package.json (
 call npm.cmd ci
 if errorlevel 1 (
  echo Installation failed. Check the output above.
  pause
  exit /b 1
 )
)
echo Open http://127.0.0.1:3001 in your browser after startup.
call npm.cmd start
pause
