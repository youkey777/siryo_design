@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1" -AppMode %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [Nanobanana Slide Studio] Launch failed. Check the logs folder.
  pause
)
exit /b %EXIT_CODE%
