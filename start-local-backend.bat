@echo off
setlocal EnableExtensions EnableDelayedExpansion
title UltraGameStudio Backend Local Server

set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"

if not exist "%BACKEND_DIR%\package.json" (
  echo [ERROR] backend\package.json not found.
  echo Run this file from the UltraGameStudio repository root.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 20+ is required.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is required.
  echo Install Node.js with npm, then run this file again.
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if !NODE_MAJOR! LSS 20 (
  echo [ERROR] Node.js 20+ is required. Current major: !NODE_MAJOR!
  pause
  exit /b 1
)

cd /d "%BACKEND_DIR%"

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created backend\.env
)

findstr /R /C:"^UGS_RUNNER_TOKEN=." ".env" >nul 2>nul
if errorlevel 1 (
  for /f "delims=" %%T in ('node src\local-token.mjs') do set "GENERATED_TOKEN=%%T"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='.env'; $t=$env:GENERATED_TOKEN; $s=Get-Content -Raw $p; if ($s -match '(?m)^UGS_RUNNER_TOKEN=') { $s=$s -replace '(?m)^UGS_RUNNER_TOKEN=.*', ('UGS_RUNNER_TOKEN='+$t) } else { $s='UGS_RUNNER_TOKEN='+$t+[Environment]::NewLine+$s }; [IO.File]::WriteAllText((Resolve-Path $p), $s, [Text.UTF8Encoding]::new($false))"
  echo Generated stable local runner token.
)

for /f "tokens=1,* delims==" %%A in ('findstr /B /C:"UGS_RUNNER_TOKEN=" ".env"') do set "RUNNER_TOKEN=%%B"

if not defined UGS_RUNNER_HOST set "UGS_RUNNER_HOST=127.0.0.1"
if not defined UGS_RUNNER_PORT set "UGS_RUNNER_PORT=8787"

rem Browsers cannot open 0.0.0.0; show/visit the loopback address instead.
set "HEALTH_HOST_DISP=%UGS_RUNNER_HOST%"
if "%HEALTH_HOST_DISP%"=="0.0.0.0" set "HEALTH_HOST_DISP=127.0.0.1"

echo.
echo UltraGameStudio backend local server
echo URL:   http://%UGS_RUNNER_HOST%:%UGS_RUNNER_PORT%
echo Admin: http://%HEALTH_HOST_DISP%:%UGS_RUNNER_PORT%/admin
echo Token: !RUNNER_TOKEN!
echo.
echo Desktop app: add remote workspace with above URL + Token.
echo Admin page:  opens in your browser automatically once the server is up.
echo Stop server: press Ctrl+C in this window.
echo.

if /I "%~1"=="--check" (
  echo Startup check OK.
  exit /b 0
)

set "HEALTH_HOST=%HEALTH_HOST_DISP%"
for /f "delims=" %%S in ('node -e "const http=require('http'); const net=require('net'); const host=process.env.HEALTH_HOST; const port=Number(process.env.UGS_RUNNER_PORT); const req=http.get({host,port,path:'/health',timeout:1500}, res => { res.resume(); process.stdout.write(res.statusCode === 200 ? 'running' : 'busy'); }); req.on('timeout', () => req.destroy()); req.on('error', () => { const s=net.createConnection({host,port}); s.setTimeout(500); s.on('connect', () => { process.stdout.write('busy'); s.destroy(); }); s.on('timeout', () => { process.stdout.write('free'); s.destroy(); }); s.on('error', () => process.stdout.write('free')); });"') do set "PORT_STATUS=%%S"
if "%PORT_STATUS%"=="running" (
  echo Backend already running: http://%HEALTH_HOST%:%UGS_RUNNER_PORT%
  pause
  exit /b 0
)
if "%PORT_STATUS%"=="busy" (
  echo [ERROR] Port %UGS_RUNNER_PORT% is already in use on %HEALTH_HOST%.
  echo Stop the process using that port, or set UGS_RUNNER_PORT to another value.
  pause
  exit /b 1
)

set "ADMIN_URL=http://%HEALTH_HOST_DISP%:%UGS_RUNNER_PORT%/admin"
echo Opening admin page once the server responds: %ADMIN_URL%
rem Background waiter: poll /health, then launch the admin page in the browser.
start "" /B powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='%ADMIN_URL%'; $h='http://%HEALTH_HOST_DISP%:%UGS_RUNNER_PORT%/health'; for($i=0;$i -lt 60;$i++){ try{ if((Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $h).StatusCode -eq 200){ Start-Process $u; break } }catch{}; Start-Sleep -Milliseconds 500 }"

call npm start
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Backend stopped. Exit code: %EXIT_CODE%
pause
exit /b %EXIT_CODE%
