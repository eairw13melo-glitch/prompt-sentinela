@echo off
setlocal
cd /d "%~dp0"
title Instalar EPUBCheck Oficial
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar_epubcheck.ps1"
echo.
if errorlevel 1 (
  echo A instalacao nao foi concluida. Leia a mensagem acima.
) else (
  echo EPUBCheck pronto para uso na plataforma.
)
pause
endlocal
