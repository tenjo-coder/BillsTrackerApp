@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm are required. Install Node.js, reopen this window, and run this file again.
  pause
  exit /b 1
)

if not exist node_modules\electron-builder (
  echo Installing Billwise build dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Building Billwise Windows installer and portable executable...
call npm run dist:win
if errorlevel 1 exit /b 1

if not exist "dist\Billwise Portable" mkdir "dist\Billwise Portable"
copy /y "dist\Billwise-Portable-1.0.0.exe" "dist\Billwise Portable\Billwise-Portable.exe" >nul
copy /y "PORTABLE_README.txt" "dist\Billwise Portable\README.txt" >nul

echo.
echo Build complete. Open "dist\Billwise Portable" to copy the self-contained app folder.
pause
