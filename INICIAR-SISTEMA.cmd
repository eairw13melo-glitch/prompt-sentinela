@echo off
setlocal
cd /d "%~dp0"
title Extrator A Sentinela - Servidor Local
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor_local.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel iniciar pelo PowerShell.
  echo Consulte o arquivo LEIA-ME.txt.
  pause
)
endlocal
