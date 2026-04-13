@echo off
setlocal

echo [Daily Poem AI Agent] Starting...

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not installed or not in PATH.
  exit /b 1
)

cd /d "%~dp0"
echo [INFO] Working directory: %cd%

npm run dev
set EXIT_CODE=%ERRORLEVEL%

echo [Daily Poem AI Agent] Exit code: %EXIT_CODE%
exit /b %EXIT_CODE%
