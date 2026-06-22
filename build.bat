@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title UltraGameStudio (Build EXE)

cd /d "%~dp0app"

echo ============================================================
echo   UltraGameStudio  -  Package Windows EXE  (tauri build)
echo ============================================================
echo.

REM ---- prerequisites ----
where node >nul 2>nul || ( echo [X] Node.js 20.19+ or 22.12+ not found: https://nodejs.org & pause & exit /b 1 )
node -e "const [maj,min]=process.versions.node.split('.').map(Number); process.exit((maj===20&&min>=19)||maj>22||(maj===22&&min>=12)?0:1)" >nul 2>nul || ( for /f "delims=" %%v in ('node -v') do echo [X] Node.js %%v is unsupported. Install Node.js 20.19+ or 22.12+. & pause & exit /b 1 )
where cargo >nul 2>nul || ( echo [X] Rust/cargo not found: https://rustup.rs & pause & exit /b 1 )
for /f "delims=" %%v in ('node -v') do echo [OK] Node.js %%v
for /f "delims=" %%v in ('cargo -V') do echo [OK] %%v
where rc >nul 2>nul
if errorlevel 1 (
    set "RC="
    for /f "delims=" %%R in ('powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\find-windows-rc.ps1" x64 2^>nul') do set "RC=%%R"
    if not defined RC (
        echo [X] Windows SDK resource compiler rc.exe not found.
        echo     Install "Windows SDK" or Visual Studio Build Tools with "Desktop development with C++".
        pause & exit /b 1
    )
    for %%D in ("!RC!") do set "PATH=%%~dpD;!PATH!"
    echo [OK] Windows resource compiler: !RC!
) else (
    for /f "delims=" %%R in ('where rc 2^>nul') do (
        echo [OK] Windows resource compiler: %%R
    )
)

echo [..] checking dependencies ...
call npm install || ( echo [X] npm install failed & pause & exit /b 1 )

if exist "src-tauri\target\release\UltraGameStudio.exe" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\stop-running-exe.ps1" "src-tauri\target\release\UltraGameStudio.exe"
    if errorlevel 1 (
        echo [X] failed to close running exe before rebuild.
        pause & exit /b 1
    )
)

echo.
echo [..] building frontend + compiling Rust + packaging installer ...
echo      (first build downloads the NSIS bundler and compiles crates;
echo       this can take several minutes)
echo ============================================================
echo.

call npm run package
if errorlevel 1 (
    echo.
    echo [X] build failed. See the log above.
    pause & exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\needs-rebuild.ps1" "%~dp0app\src-tauri\target\release\UltraGameStudio.exe" "%~dp0" -WriteStamp
if errorlevel 1 (
    echo.
    echo [X] failed to save build fingerprint.
    pause & exit /b 1
)

echo.
echo ============================================================
echo   BUILD COMPLETE
echo ============================================================
set "REL=%~dp0app\src-tauri\target\release"
echo   Standalone app : !REL!\UltraGameStudio.exe
echo   Installer (exe): !REL!\bundle\nsis\UltraGameStudio_^<version^>_x64-setup.exe
echo ------------------------------------------------------------
echo   - Double-click UltraGameStudio.exe to run directly (needs WebView2,
echo     which ships with Windows 10/11).
echo   - Or run the *_x64-setup.exe installer to install it like normal software.
echo ------------------------------------------------------------

REM ---- open the output folders in Explorer ----
if exist "!REL!\bundle\nsis" start "" explorer "!REL!\bundle\nsis"
if exist "!REL!\UltraGameStudio.exe" start "" explorer /select,"!REL!\UltraGameStudio.exe"

echo.
pause
endlocal
