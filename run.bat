@echo off
setlocal enabledelayedexpansion
title UltraGameStudio Runner
cd /d "%~dp0"

set "EXE=app\src-tauri\target\release\UltraGameStudio.exe"
set "MODE=auto"
if /I "%~1"=="/run"   set "MODE=run"
if /I "%~1"=="/build" set "MODE=build"

echo ============================================================
echo   UltraGameStudio Runner
echo ============================================================
echo   run.bat          auto: rebuild if sources changed, then launch
echo   run.bat /run     launch existing exe only
echo   run.bat /build   build only, do not launch
echo ============================================================
echo.

set "NEED_BUILD=0"
if "%MODE%"=="build" (
  set "NEED_BUILD=1"
  goto after_decide
)
if "%MODE%"=="run"   goto after_decide
if not exist "%EXE%" goto need_first_build

REM auto mode + exe exists: ask the helper whether source content changed
powershell -NoProfile -ExecutionPolicy Bypass -File "app\scripts\needs-rebuild.ps1" "%EXE%" "%CD%"
if errorlevel 1 goto sources_newer
echo [OK] exe up to date - skip build.
goto after_decide
:sources_newer
echo [..] source changed since last build - will rebuild.
set "NEED_BUILD=1"
goto after_decide

:need_first_build
echo [..] no exe yet - first build required.
set "NEED_BUILD=1"

:after_decide
if "%NEED_BUILD%"=="1" goto do_build
goto do_launch

:do_build
where node >nul 2>nul || goto no_node
node -e "const [maj,min]=process.versions.node.split('.').map(Number); process.exit((maj===20&&min>=19)||maj>22||(maj===22&&min>=12)?0:1)" >nul 2>nul || goto bad_node
where cargo >nul 2>nul || goto no_cargo
call :ensure_windows_rc
if errorlevel 1 goto no_rc
set "RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc"
echo [..] checking dependencies ...
pushd app
call npm install
set "CMD_RC=!errorlevel!"
popd
if not "!CMD_RC!"=="0" goto npm_fail
:have_deps
if exist "%EXE%" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "app\scripts\stop-ultragamestudio-instances.ps1"
  if errorlevel 1 goto stop_exe_fail
)
echo.
echo [..] building: npm run package  ^(first build compiles Rust, may take minutes^)
echo ============================================================
pushd app
call npm run package
set "CMD_RC=!errorlevel!"
popd
if not "!CMD_RC!"=="0" goto build_fail
powershell -NoProfile -ExecutionPolicy Bypass -File "app\scripts\needs-rebuild.ps1" "%EXE%" "%CD%" -WriteStamp
if errorlevel 1 goto stamp_fail
echo [OK] build done: %EXE%
if "%MODE%"=="build" goto build_only_done

:do_launch
if not exist "%EXE%" goto no_exe
powershell -NoProfile -ExecutionPolicy Bypass -File "app\scripts\stop-ultragamestudio-instances.ps1"
if errorlevel 1 goto stop_exe_fail
echo.
echo [..] launching UltraGameStudio ...
start "" "%EXE%"
echo [OK] launched an independent window. You can close this console.
echo      (self-test tip: point the in-app workspace to a project COPY.)
powershell -NoProfile -Command "Start-Sleep -Seconds 3" >nul
goto end

:build_only_done
echo.
echo [OK] build complete (not launched).
goto pause_end

:ensure_windows_rc
where rc >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%R in ('where rc 2^>nul') do (
    echo [OK] Windows resource compiler: %%R
    exit /b 0
  )
)
set "RC="
for /f "delims=" %%R in ('powershell -NoProfile -ExecutionPolicy Bypass -File "app\scripts\find-windows-rc.ps1" x64 2^>nul') do set "RC=%%R"
if not defined RC exit /b 1
for %%D in ("!RC!") do set "PATH=%%~dpD;!PATH!"
echo [OK] Windows resource compiler: !RC!
exit /b 0

:no_node
echo [X] Node.js 20.19+ or 22.12+ not found: https://nodejs.org
goto pause_end
:bad_node
for /f "delims=" %%v in ('node -v') do echo [X] Node.js %%v is unsupported. Install Node.js 20.19+ or 22.12+.
goto pause_end
:no_cargo
echo [X] Rust/cargo not found: https://rustup.rs
goto pause_end
:no_rc
echo [X] Windows SDK resource compiler rc.exe not found.
echo     Install "Windows SDK" or Visual Studio Build Tools with "Desktop development with C++".
goto pause_end
:npm_fail
echo [X] npm install failed.
goto pause_end
:build_fail
echo [X] build failed - see errors above.
goto pause_end
:stop_exe_fail
echo [X] failed to close running exe before rebuild.
goto pause_end
:stamp_fail
echo [X] failed to save build fingerprint.
goto pause_end
:no_exe
echo [X] exe not found: %EXE%
goto pause_end

:pause_end
pause
:end
endlocal
