@echo off
rem Deskcity installer for Windows: double-click it. Safe to run again; each step skips what is already done.
rem   install.cmd --yes   takes the defaults and asks nothing (basic setup, no password, no shortcuts, does not start).
rem It needs no admin rights, changes no registry settings and sends nothing anywhere (npm fetches the packages, that is all).
rem It never reads or prints your .env file.
setlocal EnableExtensions
title Deskcity installer
cd /d "%~dp0"
set "YES=0"
if /i "%~1"=="--yes" set "YES=1"
if /i "%~1"=="/y" set "YES=1"
set "DC_DIR=%~dp0"
set "DC_START=%~dp0start.cmd"

echo.
echo Deskcity installer
if "%YES%"=="1" echo (--yes: taking the defaults, asking nothing.)
echo.

echo [1/8] Checking that Node.js 20 or newer is installed...
where node >nul 2>nul
if errorlevel 1 goto :nonode
set "NODEV="
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
set "NODEMAJOR=0"
for /f "tokens=1 delims=." %%m in ("%NODEV:~1%") do set "NODEMAJOR=%%m"
if %NODEMAJOR% LSS 20 goto :nonode
echo       Node %NODEV% is installed. OK.

echo [2/8] Installing the packages (npm install). This can take a few minutes...
if exist "node_modules\.package-lock.json" goto :pkgdone
call npm install
if errorlevel 1 goto :npmfail
goto :pkgok
:pkgdone
echo       Already installed. Skipped. (To refresh them, run npm install yourself.)
goto :pkgend
:pkgok
echo       Packages installed. OK.
:pkgend

echo [3/8] Your keys file (.env)...
if exist ".env" goto :envdone
if not exist ".env.example" goto :noenvexample
copy ".env.example" ".env" >nul
if errorlevel 1 goto :envfail
echo       Made .env from .env.example.
if "%YES%"=="1" goto :envyes
echo       Opening .env in Notepad. Paste your Claude key after ANTHROPIC_API_KEY=, then save and close Notepad.
echo       No key yet? Just close it: you can try the demo with npm run demo, and add the key later.
call :editfile ".env"
goto :envend
:envyes
echo       Skipped editing it. Open .env in Notepad later and paste your Claude key after ANTHROPIC_API_KEY=.
goto :envend
:envdone
echo       .env is already there. Skipped.
:envend

echo [4/8] Dashboard password...
node tools\setup.mjs --check | findstr /c:"dashboard password set" >nul
if not errorlevel 1 goto :pwdone
call :ask "Set a dashboard password now? (needed for spending and phone access)" N N
if not "%ANS%"=="Y" goto :pwskip
call npm run set-password
if errorlevel 1 echo       No password was set. You can run npm run set-password any time.
goto :pwend
:pwskip
echo       Skipped. Run npm run set-password any time. Until then anything on this PC can start paid work.
goto :pwend
:pwdone
echo       A password is already set. Skipped.
:pwend

echo [5/8] Your projects and settings...
if exist "data\hub-settings.json" goto :setupdone
if "%YES%"=="1" goto :basic
echo       1 = Set up with Claude Code (it asks you a few questions)
echo       2 = Basic setup now (edit a short answers file in Notepad)
echo       3 = Skip for now
set "CH=2"
set /p "CH=      Choose 1, 2 or 3 [2]: "
if "%CH%"=="1" goto :claudecode
if "%CH%"=="3" goto :setupskip
:basic
if exist "data\setup-answers.json" goto :haveanswers
node tools\setup.mjs --example
if errorlevel 1 goto :setupfail
:haveanswers
if "%YES%"=="1" goto :runanswers
echo       Opening data\setup-answers.json in Notepad. Put in your name and projects, then save and close it.
call :editfile "data\setup-answers.json"
:runanswers
node tools\setup.mjs --answers data/setup-answers.json
if errorlevel 1 goto :setupfail
echo       Settings made. OK.
goto :setupend
:claudecode
echo       Open this folder in Claude Code and say: set up my hub
echo       It follows docs\kit\SETUP.md and asks you a few questions.
goto :setupend
:setupskip
echo       Skipped. Run this installer again, or see the README, when you are ready.
goto :setupend
:setupdone
echo       Settings already exist (data\hub-settings.json). Skipped.
:setupend

echo [6/8] Checking what is in place...
node tools\setup.mjs --check

echo [7/8] Shortcuts (both are optional)...
call :ask "Put a Deskcity icon on your desktop?" N N
if not "%ANS%"=="Y" goto :desktopskip
call :shortcut Desktop 1 ""
:desktopskip
call :ask "Start Deskcity by itself when you sign in to Windows? (minimized)" N N
if not "%ANS%"=="Y" goto :startupskip
call :shortcut Startup 7 "--no-browser"
:startupskip
echo       To remove them later, run uninstall-autostart.cmd.

echo [8/8] Starting...
call :ask "Start Deskcity now?" Y N
if not "%ANS%"=="Y" goto :nostart
echo       Starting it in a new window named Deskcity. Your browser opens when it is ready.
start "Deskcity" "%~dp0start.cmd"
goto :done
:nostart
echo       Not started. Start it any time by double-clicking start.cmd.

:done
echo.
echo Done. Start Deskcity any time with start.cmd.
if "%YES%"=="0" pause
exit /b 0

:nonode
echo.
echo       Node.js 20 or newer was not found (or is too old). Get it from https://nodejs.org
echo       (the LTS version), install it, then run this installer again.
call :ask "Open nodejs.org in your browser now?" Y N
if "%ANS%"=="Y" call :openurl https://nodejs.org
goto :fail

:npmfail
echo.
echo       npm install did not finish. Read the lines above for the reason (often no internet).
echo       Fix that and run this installer again.
goto :fail

:noenvexample
echo.
echo       .env.example is missing, so .env could not be made. Re-download the Deskcity files.
goto :fail

:envfail
echo.
echo       Could not make .env. Is this folder read-only?
goto :fail

:setupfail
echo.
echo       The setup did not finish. Read the lines above, fix the answers file, and run this installer again.
goto :fail

:fail
echo.
echo The installer stopped. Run it again after fixing the above.
if "%YES%"=="0" pause
exit /b 1

rem ---- helpers ----

:ask
rem call :ask "question" default-if-asked default-with---yes   (sets ANS to Y or N)
set "ANS=%~2"
if "%YES%"=="1" set "ANS=%~3"
if "%YES%"=="1" exit /b 0
set "REPLY="
set /p "REPLY=      %~1 [%~2 is the default, type Y or N]: "
if not defined REPLY exit /b 0
if /i "%REPLY:~0,1%"=="Y" set "ANS=Y"
if /i "%REPLY:~0,1%"=="N" set "ANS=N"
exit /b 0

:editfile
rem opens a file in Notepad and waits until you press a key
start /wait notepad %1
echo       Saved and closed it? Press any key to go on.
pause >nul
exit /b 0

:openurl
if "%DESKCITY_NO_BROWSER%"=="1" (echo       Browser open skipped. Go to %1 yourself.) else start "" %1
exit /b 0

:shortcut
rem call :shortcut Desktop|Startup window-style(1 normal, 7 minimized) "arguments"
set "DC_KIND=%~1"
set "DC_STYLE=%~2"
set "DC_ARGS=%~3"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f = Join-Path ([Environment]::GetFolderPath($env:DC_KIND)) 'Deskcity.lnk'; $w = New-Object -ComObject WScript.Shell; if (Test-Path $f) { if ($w.CreateShortcut($f).TargetPath -eq $env:DC_START) { exit 2 } else { exit 3 } }; $s = $w.CreateShortcut($f); $s.TargetPath = $env:DC_START; $s.Arguments = $env:DC_ARGS; $s.WorkingDirectory = $env:DC_DIR; $s.WindowStyle = [int]$env:DC_STYLE; $s.Description = 'Deskcity'; $s.Save()"
if errorlevel 3 (echo       A shortcut named Deskcity in your %DC_KIND% folder points somewhere else. Left alone.& exit /b 0)
if errorlevel 2 (echo       The %DC_KIND% shortcut is already there. Skipped.& exit /b 0)
if errorlevel 1 (echo       Could not make the %DC_KIND% shortcut.& exit /b 0)
echo       Made the %DC_KIND% shortcut named Deskcity.
exit /b 0
