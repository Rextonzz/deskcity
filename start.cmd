@echo off
rem Starts Deskcity and starts it again 10 seconds after a crash. Close this window to stop it.
rem   start.cmd --no-browser   (or DESKCITY_NO_BROWSER=1) does not open the browser.
rem If a hub is already running on this folder, this stops instead of starting a second one.
setlocal EnableExtensions
title Deskcity
cd /d "%~dp0"
if /i "%~1"=="--no-browser" set "DESKCITY_NO_BROWSER=1"

where node >nul 2>nul
if errorlevel 1 goto :nonode

set "DC_PORT=3000"
for /f "delims=" %%p in ('node tools\open-when-ready.mjs --port') do set "DC_PORT=%%p"
echo Deskcity is starting. It will be at http://localhost:%DC_PORT%
echo Close this window to stop it.
rem Opens the page once the hub answers (the first start only; skipped with --no-browser).
start "" /b node tools\open-when-ready.mjs

:loop
call npm start
rem The hub exits with 3 when it is refused because one is already running (see server.js): stop, do not loop.
if errorlevel 3 if not errorlevel 4 goto :already
echo.
echo Deskcity stopped. Starting it again in 10 seconds. Close this window to stop it.
ping -n 11 127.0.0.1 >nul
goto :loop

:already
echo.
echo Deskcity is already running (see above), so this window did not start a second one.
echo It is at http://localhost:%DC_PORT%
pause
exit /b 0

:nonode
echo Node.js 20 or newer was not found. Run install.cmd, or get it from https://nodejs.org
pause
exit /b 1
