@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env
  echo Edit UGS_RUNNER_TOKEN before exposing this server.
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required.
  pause
  exit /b 1
)

if /I "%~1"=="--check" (
  echo Startup check OK.
  exit /b 0
)

call npm start
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Backend stopped. Exit code: %EXIT_CODE%
pause
exit /b %EXIT_CODE%
