@echo off
setlocal DisableDelayedExpansion
set "BOOTSTRAP=%~dp0installer\Install.ps1"
if exist "%~dp0Install.ps1" set "BOOTSTRAP=%~dp0Install.ps1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%BOOTSTRAP%" %*
set "INSTALL_EXIT=%errorlevel%"
if not defined DSH_NEXT_INSTALL_NO_PAUSE pause
exit /b %INSTALL_EXIT%
