@echo off
title Castle Tower Defense
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

rem Same choice as phoneJoinUrl in src/server/app.ts:
rem   play — this process serves the built client, so phones use port 4777
rem   dev  — Vite serves the client, so phones use port 5180
if /I "%~1"=="dev" (
  call :free 4777
  call :free 5180
  echo Dev mode. This PC: http://localhost:5180
  echo Phones on your Wi-Fi use port 5180. A QR code will appear below.
  npm run dev
) else (
  call :free 4777
  echo Building the client, then starting the server.
  echo This PC: http://localhost:4777
  echo Phones on your Wi-Fi use port 4777. A QR code will appear below.
  npm run play
)
exit /b %errorlevel%

:free
echo Freeing port %~1 if a previous server is still using it...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort %~1 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
exit /b 0
