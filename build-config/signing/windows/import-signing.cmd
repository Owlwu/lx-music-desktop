@echo off
rem Run import-win-signing.ps1 with execution policy bypass.
rem Example:
rem   import-signing.cmd -PfxPath lxmusic-codesign.p12 -Password "secret" -ImportCert -TrustRoot
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0import-win-signing.ps1" %*
exit /b %ERRORLEVEL%
