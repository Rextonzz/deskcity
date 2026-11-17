@echo off
rem Removes the Deskcity desktop icon and the start-at-sign-in shortcut that install.cmd can make.
rem It only removes shortcuts named Deskcity that point at THIS folder's start.cmd. Nothing else is touched.
setlocal EnableExtensions
title Deskcity: remove shortcuts
set "DC_START=%~dp0start.cmd"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w = New-Object -ComObject WScript.Shell; foreach ($k in 'Desktop','Startup') { $f = Join-Path ([Environment]::GetFolderPath($k)) 'Deskcity.lnk'; if (-not (Test-Path $f)) { Write-Host \"No $k shortcut.\" } elseif ($w.CreateShortcut($f).TargetPath -eq $env:DC_START) { Remove-Item $f; Write-Host \"Removed the $k shortcut.\" } else { Write-Host \"The $k shortcut points to another folder. Left alone.\" } }"
echo.
echo Done. Deskcity itself and your data were not touched.
if /i not "%~1"=="--yes" pause
