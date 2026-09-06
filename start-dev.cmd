@echo off
rem Double-click launcher for the local Dragon Island Blue port.
rem Runs Offline by default. Pass --online to also start the authoritative game API.
rem Runs the web dev server in this window. Closing this window (or Ctrl+C) stops the client.
setlocal EnableExtensions EnableDelayedExpansion
title Dragon Island Blue - dev servers
cd /d "%~dp0"

echo === Dragon Island Blue: local servers ===
echo Repo: %CD%
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [x] pnpm was not found on PATH.
  echo     Install Node 20.11+ then run:  corepack enable pnpm
  goto :fail
)

if exist "node_modules" (
  echo [1/3] Dependencies present, skipping install.
) else (
  echo [1/3] Installing workspace dependencies ^(first run only, takes a while^)...
  call pnpm install
  if errorlevel 1 goto :fail
)

echo.
if /i not "%~1"=="--online" (
  echo [2/3] Offline development: skipping the optional authoritative API.
  echo       Use start-dev.cmd --online to start it as well.
  goto :web
)
set "GAME_PORT=%DIB_GAME_PORT%"
if not defined GAME_PORT set "GAME_PORT=8788"
set "DIB_GAME_PROXY_PORT=%GAME_PORT%"
set "GAME_READY="
if exist "hmac.txt" set "GAME_READY=1"
if defined DIB_GAME_HMAC_SECRET set "GAME_READY=1"
if defined DIB_GAME_HMAC_SECRET_FILE set "GAME_READY=1"

call :portInUse %GAME_PORT%
if "!PORT_IN_USE!"=="1" (
  echo [x] Port %GAME_PORT% already has an authoritative game API listening.
  echo.
  echo     Stop that older API window and run start-dev.cmd again. Reusing a server process
  echo     from an earlier checkout can pair this client with incompatible gameplay rules.
  goto :fail
) else if defined GAME_READY (
  echo [2/3] Starting the authoritative game API on port %GAME_PORT% in a separate window...
  start "DIB authoritative game API" cmd /k pnpm game:dev
) else (
  echo [2/3] Skipping Official online: no HMAC secret found.
  echo       The game runs fine without it ^(browser-local saves only^).
  echo       To enable it, put a random secret in hmac.txt at the repo root.
)

:web
echo.
rem Browser-local saves live in localStorage, which is scoped to the ORIGIN. Walking to the next
rem free port silently moves the game to a different origin, where the save slots appear empty.
rem The port is therefore pinned: if it is busy, stop and say so rather than hiding the saves.
set "WEB_PORT=%DIB_WEB_PORT%"
if not defined WEB_PORT set "WEB_PORT=5173"

call :portInUse %WEB_PORT%
if "!PORT_IN_USE!"=="1" (
  echo [x] Port %WEB_PORT% is already in use.
  echo.
  echo     The web client always uses the same port on purpose: browser-local saves are tied
  echo     to http://localhost:%WEB_PORT%/ and would look EMPTY on any other port.
  echo.
  echo     Either close whatever is using port %WEB_PORT% ^(often an older dev server in
  echo     another window^), or, if you really want a separate instance with its own saves:
  echo         set DIB_WEB_PORT=5273 ^&^& start-dev.cmd
  goto :fail
)

echo [3/3] Starting the web client on http://localhost:%WEB_PORT%/
echo.
echo       When the page loads, choose a compatible IPA/ZIP resource package
echo       ^(e.g. Dragon_Island_Blue_1.1.0.ipa in this folder, or one of the
echo       clean_room packages^). Nothing is uploaded; it stays in the tab.
echo.
echo       Press Ctrl+C in this window to stop the client.
echo.

start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 6; Start-Process 'http://localhost:%WEB_PORT%/'"
call pnpm --filter @dib/web exec vite --host --port %WEB_PORT% --strictPort

echo.
echo The web dev server has stopped. The authoritative game API window, if any, is still open.
goto :end

:portInUse
set "PORT_IN_USE=0"
for /f "delims=" %%r in ('powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %~1 -State Listen -ErrorAction SilentlyContinue) { 1 } else { 0 }"') do set "PORT_IN_USE=%%r"
exit /b 0

:fail
echo.
echo Startup failed - see the messages above.
pause
exit /b 1

:end
pause
exit /b 0
